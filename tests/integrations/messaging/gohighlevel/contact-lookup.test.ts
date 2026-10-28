import assert from "node:assert/strict";
import test from "node:test";
import { createIntegrationContext } from "../../../../src/context/integration";
import type { Tenant } from "../../../../src/tenants/types";
import {
  lookupGHLContactByPhone,
  normalizeMetaSenderPhone,
} from "../../../../src/integrations/crm/gohighlevel/contacts/lookup";
import { ApiError } from "../../../../src/core/errors/ApiError";

function tenant(locationId = "location-a"): Tenant {
  return {
    id: "tenant-a",
    name: "Tenant A",
    status: "active",
    integrations: {
      crm: {
        id: "ghl-a",
        provider: "gohighlevel",
        credentials: { locationId },
        configuration: null,
      },
      pms: { provider: "browser" },
    },
  };
}

function context(response: unknown, request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const credentials = { async resolve() { return { authType: "oauth2" as const, accessToken: "synthetic-token", resourceId: "location-a" }; } };
  return createIntegrationContext(tenant(), "gohighlevel", {
    transportMode: "mock",
    credentials,
    httpTransport: {
      credentials,
      fetch: request,
    },
  });
}

test("Meta sender normalization produces an E.164 lookup value", () => {
  assert.equal(normalizeMetaSenderPhone("6012 345 6789"), "+60123456789");
  assert.equal(normalizeMetaSenderPhone("+60123456789"), "+60123456789");
  assert.equal(normalizeMetaSenderPhone("local-number"), null);
});

test("GHL contact lookup is exact, location-scoped, and returns the provider contact ID", async () => {
  let requested = "";
  const result = await lookupGHLContactByPhone(
    context({ contacts: [{ id: "ghl-contact-a", locationId: "location-a" }] }, async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ contacts: [{ id: "ghl-contact-a", locationId: "location-a" }] }), { status: 200 });
    }),
    "60123456789",
  );
  assert.equal(result, "ghl-contact-a");
  const url = new URL(requested);
  assert.equal(url.pathname, "/contacts/lookup");
  assert.equal(url.searchParams.get("locationId"), "location-a");
  assert.equal(url.searchParams.get("phone"), "+60123456789");
});

test("GHL contact lookup rejects cross-location results and ambiguous matches", async () => {
  const missing = await lookupGHLContactByPhone(
    context(null, async () => new Response(JSON.stringify({ contacts: [] }), { status: 200 })),
    "60123456789",
  );
  assert.equal(missing, null);
  const wrongLocation = await lookupGHLContactByPhone(
    context(null, async () => new Response(JSON.stringify({ contacts: [{ id: "other-contact", locationId: "location-b" }] }), { status: 200 })),
    "60123456789",
  );
  assert.equal(wrongLocation, null);
  await assert.rejects(
    lookupGHLContactByPhone(
      context(null, async () => new Response(JSON.stringify({ contacts: [
        { id: "ghl-contact-a", locationId: "location-a" },
        { id: "ghl-contact-b", locationId: "location-a" },
      ] }), { status: 200 })),
      "60123456789",
    ),
    /More than one GHL contact matched/,
  );
});

test("GHL contact lookup propagates provider errors without selecting a contact", async () => {
  await assert.rejects(
    lookupGHLContactByPhone(
      context(null, async () => new Response(JSON.stringify({ message: "synthetic denial" }), { status: 403 })),
      "60123456789",
    ),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
});
