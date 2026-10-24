import type {
  IntegrationCredentialRequest,
  IntegrationCredentialResolver,
  IntegrationRuntime,
  ResolvedIntegrationCredential,
} from "../../../../core/integration/runtime";
import type { GHLContact, GHLOpportunity } from "../types";

const MOCK_TOKEN = "synthetic-ghl-mock-token";

export type GHLMockOperation =
  | "contact_upsert"
  | "contact_get"
  | "contact_update"
  | "opportunity_upsert"
  | "opportunity_search"
  | "opportunity_update";

export type GHLMockFailure = "transient" | "permanent" | "invalid_response";

export interface GHLMockEnvironmentOptions {
  tenantId: string;
  locationId: string;
  reservationFieldId: string;
}

export interface GHLMockEnvironment {
  runtime: IntegrationRuntime;
  fetch: typeof fetch;
  failNext(operation: GHLMockOperation, failure: GHLMockFailure): void;
  snapshot(): { contactCount: number; opportunityCount: number };
}

interface StoredContact {
  locationId: string;
  value: GHLContact;
}

interface StoredOpportunity {
  locationId: string;
  value: GHLOpportunity;
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizedIdentity(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

async function stableId(kind: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const suffix = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `mock_${kind}_${suffix}`;
}

/**
 * Creates an isolated in-memory GHL HTTP fake. It only accepts the configured
 * synthetic tenant/location and the paired synthetic bearer credential.
 */
export function createGHLMockEnvironment(
  options: GHLMockEnvironmentOptions,
): GHLMockEnvironment {
  const tenantId = options.tenantId.trim();
  const locationId = options.locationId.trim();
  const reservationFieldId = options.reservationFieldId.trim();
  if (!tenantId || !locationId || !reservationFieldId) {
    throw new Error("Synthetic GHL tenant, location, and reservation field are required.");
  }

  const contacts = new Map<string, StoredContact>();
  const contactIdentityIndex = new Map<string, string>();
  const opportunities = new Map<string, StoredOpportunity>();
  const opportunityReservationIndex = new Map<string, string>();
  const failures = new Map<GHLMockOperation, GHLMockFailure[]>();

  const indexContact = (id: string, contact: GHLContact): void => {
    for (const [key, indexedId] of contactIdentityIndex) {
      if (indexedId === id) contactIdentityIndex.delete(key);
    }
    const email = normalizedIdentity(contact.email);
    const phone = normalizedIdentity(contact.phone);
    if (email) contactIdentityIndex.set(`email:${email}`, id);
    if (phone) contactIdentityIndex.set(`phone:${phone}`, id);
  };

  const credentials: IntegrationCredentialResolver = {
    async resolve(request: IntegrationCredentialRequest): Promise<ResolvedIntegrationCredential> {
      if (
        request.tenantId !== tenantId ||
        request.provider !== "gohighlevel" ||
        request.resourceId !== locationId
      ) {
        throw new Error("Synthetic GHL credential scope mismatch.");
      }
      if (request.forceRefresh) {
        throw new Error("Synthetic GHL credentials do not support OAuth refresh.");
      }
      return { authType: "api_key", accessToken: MOCK_TOKEN, resourceId: locationId };
    },
  };

  const takeFailure = (operation: GHLMockOperation): GHLMockFailure | undefined => {
    const queued = failures.get(operation);
    const next = queued?.shift();
    if (queued?.length === 0) failures.delete(operation);
    return next;
  };

  const verifyRequest = (url: URL, init?: RequestInit): Response | undefined => {
    if (url.origin !== "https://services.leadconnectorhq.com") {
      return jsonResponse(403, { message: "Mock transport rejects non-GHL hosts." });
    }
    const headers = new Headers(init?.headers);
    if (headers.get("Authorization") !== `Bearer ${MOCK_TOKEN}`) {
      return jsonResponse(401, { message: "Synthetic GHL credential rejected." });
    }
    if (
      url.searchParams.has("locationId") &&
      url.searchParams.get("locationId") !== locationId
    ) {
      return jsonResponse(403, { message: "Synthetic GHL location mismatch." });
    }
    return undefined;
  };

  const parseBody = (init?: RequestInit): Record<string, unknown> => {
    if (typeof init?.body !== "string") return {};
    try {
      return objectValue(JSON.parse(init.body)) ?? {};
    } catch {
      return {};
    }
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      return jsonResponse(400, { message: "Invalid synthetic GHL URL." });
    }

    const rejected = verifyRequest(url, init);
    if (rejected) return rejected;

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = url.pathname;
    const body = parseBody(init);
    let operation: GHLMockOperation | undefined;

    if (method === "POST" && path === "/contacts/upsert") operation = "contact_upsert";
    else if (method === "GET" && /^\/contacts\/[^/]+$/.test(path)) operation = "contact_get";
    else if (method === "PUT" && /^\/contacts\/[^/]+$/.test(path)) operation = "contact_update";
    else if (method === "POST" && path === "/opportunities/upsert") operation = "opportunity_upsert";
    else if (method === "GET" && path === "/opportunities/search") operation = "opportunity_search";
    else if (method === "PUT" && /^\/opportunities\/[^/]+$/.test(path)) operation = "opportunity_update";
    else return jsonResponse(404, { message: "Unsupported synthetic GHL operation." });

    const bodyLocation = typeof body.locationId === "string" ? body.locationId : undefined;
    if (bodyLocation !== undefined && bodyLocation !== locationId) {
      return jsonResponse(403, { message: "Synthetic GHL location mismatch." });
    }

    const failure = takeFailure(operation);
    if (failure === "transient") return jsonResponse(503, { message: "Synthetic transient provider failure." });
    if (failure === "permanent") return jsonResponse(400, { message: "Synthetic invalid provider request." });
    if (failure === "invalid_response") return jsonResponse(200, { unexpected: true });

    if (operation === "contact_upsert") {
      const candidate = body as unknown as GHLContact & { locationId?: string };
      const email = normalizedIdentity(candidate.email);
      const phone = normalizedIdentity(candidate.phone);
      if (!email && !phone) return jsonResponse(400, { message: "A synthetic contact email or phone is required." });
      const identityKey = email ? `email:${email}` : `phone:${phone}`;
      const existingId = (email && contactIdentityIndex.get(`email:${email}`)) ??
        (phone && contactIdentityIndex.get(`phone:${phone}`));
      const id = existingId ?? await stableId("contact", `${tenantId}\n${locationId}\n${identityKey}`);
      const previous = contacts.get(id)?.value;
      const value: GHLContact = { ...previous, ...candidate, id };
      contacts.set(id, { locationId, value });
      indexContact(id, value);
      return jsonResponse(200, { contact: value });
    }

    if (operation === "contact_get" || operation === "contact_update") {
      const id = decodeURIComponent(path.split("/").at(-1) ?? "");
      const stored = contacts.get(id);
      if (!stored || stored.locationId !== locationId) return jsonResponse(404, { message: "Synthetic contact not found." });
      if (operation === "contact_get") return jsonResponse(200, { contact: stored.value });

      const patch = body as Partial<GHLContact>;
      const fields = new Map((stored.value.customFields ?? []).map((field) => [field.id, field]));
      for (const field of patch.customFields ?? []) fields.set(field.id, field);
      const value: GHLContact = { ...stored.value, ...patch, id, customFields: [...fields.values()] };
      contacts.set(id, { locationId, value });
      indexContact(id, value);
      return jsonResponse(200, { contact: value });
    }

    if (operation === "opportunity_upsert") {
      const candidate = body as unknown as GHLOpportunity & { locationId?: string };
      const reservationId = candidate.customFields?.find((field) => field.id === reservationFieldId)?.field_value;
      if (!candidate.contactId || !reservationId) return jsonResponse(400, { message: "Synthetic opportunity identity is incomplete." });
      if (!contacts.has(candidate.contactId)) return jsonResponse(404, { message: "Synthetic opportunity contact not found." });
      const reservationKey = `${locationId}\n${candidate.contactId}\n${reservationId}`;
      const existingId = opportunityReservationIndex.get(reservationKey);
      const id = existingId ?? await stableId("opportunity", `${tenantId}\n${reservationKey}`);
      const previous = opportunities.get(id)?.value;
      const value: GHLOpportunity = { ...previous, ...candidate, id };
      opportunities.set(id, { locationId, value });
      opportunityReservationIndex.set(reservationKey, id);
      return jsonResponse(200, { opportunity: value });
    }

    if (operation === "opportunity_search") {
      const requestedContact = url.searchParams.get("contactId");
      return jsonResponse(200, {
        opportunities: [...opportunities.values()]
          .filter((entry) => entry.locationId === locationId && entry.value.contactId === requestedContact)
          .map((entry) => entry.value),
      });
    }

    const id = decodeURIComponent(path.split("/").at(-1) ?? "");
    const stored = opportunities.get(id);
    if (!stored || stored.locationId !== locationId) return jsonResponse(404, { message: "Synthetic opportunity not found." });
    const patch = body as Partial<GHLOpportunity>;
    const fields = new Map((stored.value.customFields ?? []).map((field) => [field.id, field]));
    for (const field of patch.customFields ?? []) fields.set(field.id, field);
    const value: GHLOpportunity = { ...stored.value, ...patch, id, customFields: [...fields.values()] };
    opportunities.set(id, { locationId, value });
    return jsonResponse(200, value);
  };

  const neverResolveLiveCredentials: IntegrationCredentialResolver = {
    async resolve(): Promise<ResolvedIntegrationCredential> {
      throw new Error("Live credential resolution is unavailable in GHL mock mode.");
    },
  };

  return {
    runtime: {
      credentials: neverResolveLiveCredentials,
      transportMode: "mock",
      httpTransport: { fetch, credentials },
    },
    fetch,
    failNext(operation, failure) {
      failures.set(operation, [...(failures.get(operation) ?? []), failure]);
    },
    snapshot() {
      return { contactCount: contacts.size, opportunityCount: opportunities.size };
    },
  };
}
