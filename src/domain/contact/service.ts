import type { RequestContext } from "../../context";

import { logger } from "../../core/logger";
import { normalizePhoneNumber, resolveCRMAdapter } from "../../core/crm";

import type { CreateContactRequest } from "./schemas";

import { parseContactEventSnapshot } from "./event-parser";

import type { Contact } from "../../core/crm/models/contact";

import { ApiError } from "../../core/errors/ApiError";

function errorCategory(error: unknown): string {
  if (error instanceof TypeError) return "type_error";
  if (error instanceof RangeError) return "range_error";
  if (error instanceof SyntaxError) return "syntax_error";
  return error instanceof Error ? "error" : "unknown";
}

function readContactSnapshot(context: RequestContext, operation: string, payload: Partial<CreateContactRequest>) {
  const snapshot = parseContactEventSnapshot(
    Object.hasOwn(payload, "notes") ? payload.notes : undefined,
  );
  logger.info("Contact events parsed", {
    operation,
    provider: context.tenant.integrations.crm.provider,
    correlationId: context.requestId,
    snapshotKind: snapshot.kind,
    eventCount: snapshot.kind === "complete" ? snapshot.events.length : 0,
  });
  if (snapshot.kind === "malformed" && typeof payload.notes !== "string") {
    throw new ApiError(400, "Contact notes must be a string.", undefined, "VALIDATION_ERROR");
  }
  return snapshot;
}

async function syncCompleteContactSnapshot(
  context: RequestContext,
  crm: ReturnType<typeof resolveCRMAdapter>,
  contact: Contact,
  snapshot: ReturnType<typeof parseContactEventSnapshot>,
): Promise<void> {
  // Only a nonempty, fully parsed snapshot authorizes replacing associated
  // events. Omitted, blank, undated and malformed notes preserve those records.
  if (snapshot.kind !== "complete") return;
  try {
    if (!contact.id) throw new Error("Saved contact ID is unavailable.");
    await crm.syncContactEvents(context, { contactId: contact.id, events: snapshot.events });
  } catch (error) {
    logger.error("Contact saved; event synchronization failed", {
      operation: "contact.events.sync",
      provider: context.tenant.integrations.crm.provider,
      correlationId: context.requestId,
      outcome: "partial_success",
      providerStatus: error instanceof ApiError ? error.status : undefined,
      errorCategory: error instanceof ApiError ? "provider_error" : errorCategory(error),
    });
  }
}

function clinicSettings(context: RequestContext) {
  return context.tenant.integrations.crm.configuration?.providerConfiguration?.clinicContactSync;
}

type ClinicStage = "synchronized" | "skipped" | "failed";

export function requireClinicContactSync(context: RequestContext) {
  const crm = resolveCRMAdapter(context.tenant);
  const settings = clinicSettings(context);
  if (!settings || typeof settings !== "object" ||
      context.client.tenantId !== context.tenant.id ||
      !("locationId" in settings) || typeof settings.locationId !== "string" || !settings.locationId.trim() ||
      settings.locationId !== context.tenant.integrations.crm.credentials.locationId ||
      !("managedOwnerFieldKey" in settings) || typeof settings.managedOwnerFieldKey !== "string" ||
      !settings.managedOwnerFieldKey.trim() || context.tenant.integrations.crm.provider !== "gohighlevel" ||
      !crm.syncContactNotes || !crm.runClinicContactSync) {
    throw new ApiError(403, "Clinic contact synchronization is unavailable.", undefined, "FORBIDDEN");
  }
  return { crm, syncNotes: crm.syncContactNotes, runSync: crm.runClinicContactSync };
}

async function reconcileClinicContact(
  context: RequestContext, payload: CreateContactRequest,
) {
  const { crm, syncNotes, runSync } = requireClinicContactSync(context);
  const mode = payload.clinicNotesSync;
  if (payload.id !== undefined || payload.email !== undefined || !normalizePhoneNumber(payload.phone) || typeof payload.notes !== "string" ||
      (mode === "clear" && (typeof payload.identityNumber !== "string" || !payload.identityNumber.trim())) ||
      (mode !== "replace" && mode !== "clear" && mode !== "note_only")) {
    throw new ApiError(400, "Invalid clinic contact snapshot.", undefined, "VALIDATION_ERROR");
  }
  const capturedAt = payload.clinicNotesCapturedAt;
  const now = Date.now();
  if (typeof capturedAt !== "number" || !Number.isSafeInteger(capturedAt) ||
      capturedAt < now - 120_000 || capturedAt > now + 30_000) {
    throw new ApiError(409, "Clinic notes must be read again.", undefined, "CONFLICT");
  }
  const snapshot = parseContactEventSnapshot(payload.notes, { clinic: true });
  if ((mode === "replace" && snapshot.kind !== "complete") ||
      (mode !== "replace" && snapshot.kind !== "blank" && snapshot.kind !== "undated")) {
    throw new ApiError(400, "Invalid clinic contact snapshot.", undefined, "VALIDATION_ERROR");
  }
  // Snapshot replacement and clearing can delete managed Contact Events.
  // Require the existing destructive contact permission in addition to the
  // route's contacts:create permission before any provider write occurs.
  if ((mode === "replace" || mode === "clear") &&
      !context.client.permissions.includes("*") &&
      !context.client.permissions.includes("contacts:delete")) {
    throw new ApiError(403, "Insufficient permissions.", undefined, "FORBIDDEN");
  }

  const { notes, clinicNotesSync: _mode, clinicNotesCapturedAt: _captured, ...fields } = payload;
  const contact = await crm.upsertContact(context, fields, {
    verifyOwnership: true,
    ...(mode === "clear" ? { existingOnly: true } : {}),
  });
  if (!contact.id) throw new Error("Saved contact ID is unavailable.");
  const contactId = contact.id;
  return runSync.call(crm, context, contactId, capturedAt, async () => {
    const sync: { contactSaved: true; nativeNote: ClinicStage; contactEvents: ClinicStage;
      status: "synchronized" | "partial_failure"; retryable: boolean } = {
      contactSaved: true, nativeNote: "skipped", contactEvents: "skipped", status: "synchronized", retryable: false,
    };
    function recordFailure(stage: "nativeNote" | "contactEvents", error: unknown) {
      sync[stage] = "failed";
      sync.status = "partial_failure";
      sync.retryable = error instanceof TypeError || (error instanceof ApiError &&
        (error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500));
      logger.warn("Clinic contact synchronization stage failed", {
        correlationId: context.requestId, stage, errorCategory: errorCategory(error),
      });
    }

    if (snapshot.kind !== "blank") {
      try {
        await syncNotes.call(crm, context, contactId, notes);
        sync.nativeNote = "synchronized";
      } catch (error) {
        recordFailure("nativeNote", error);
        return { ...contact, synchronization: sync };
      }
    }
    if (mode === "note_only") return { ...contact, synchronization: sync };
    try {
      await crm.syncContactEvents(context, {
        contactId,
        managedOnly: true,
        ...(mode === "clear" ? { clearManaged: true } : {}),
        events: snapshot.kind === "complete" ? snapshot.events : [],
      });
      sync.contactEvents = "synchronized";
    } catch (error) {
      recordFailure("contactEvents", error);
    }
    return { ...contact, synchronization: sync };
  });
}

/** Create or update a contact using the tenant's CRM adapter. */
export async function createContactService(
  context: RequestContext,
  payload: CreateContactRequest,
) {
  const crm = resolveCRMAdapter(context.tenant);
  if (Object.hasOwn(payload, "clinicNotesSync")) return reconcileClinicContact(context, payload);
  const snapshot = readContactSnapshot(context, "contact.create", payload);
  const savedContact = await crm.upsertContact(context, {
    ...payload,
    ...(snapshot.kind === "blank" ? { notes: undefined } : {}),
    ...(snapshot.kind === "complete" ? { events: snapshot.events } : {}),
  });
  if (payload.source !== "avixo-clinic" && clinicSettings(context) === undefined) {
    await syncCompleteContactSnapshot(context, crm, savedContact, snapshot);
  }
  return savedContact;
}

/**
 * Get contact by email.
 */
export async function getContactService(
  context: RequestContext,
  email: string
) {
  const crm = resolveCRMAdapter(context.tenant);

  const contact = await crm.searchContact(
    context,
    email
  );

  if (!contact?.id) {
    throw new Error("Contact not found.");
  }

  return crm.getContact(
    context,
    contact.id
  );
}

/**
 * Update an existing contact.
 */
export async function updateContactService(
  context: RequestContext,
  payload: Partial<CreateContactRequest>,
) {
  const crm = resolveCRMAdapter(context.tenant);

  if (!payload.id) {
    throw new Error("Contact ID is required.");
  }

  const snapshot = readContactSnapshot(context, "contact.update", payload);
  const updatedContact = await crm.updateContact(context, payload.id, {
    ...payload,
    ...(snapshot.kind === "blank" ? { notes: undefined } : {}),
    ...(snapshot.kind === "complete" ? { events: snapshot.events } : {}),
  });
  if (clinicSettings(context) === undefined) {
    await syncCompleteContactSnapshot(context, crm, updatedContact, snapshot);
  }

  return updatedContact;
}


/**
 * Delete an existing contact.
 */
export async function deleteContactService(
  context: RequestContext,
  payload: {
    id?: string;
    email?: string;
  }
) {
  const crm = resolveCRMAdapter(context.tenant);

  // Fast path
  if (payload.id) {
    await crm.deleteContact(
      context,
      payload.id
    );

    return {
      success: true,
    };
  }

  // Lookup by email
  if (payload.email) {
    const contact = await crm.searchContact(
      context,
      payload.email
    );

    if (!contact?.id) {
      throw new Error("Contact not found.");
    }

    await crm.deleteContact(
      context,
      contact.id
    );

    return {
      success: true,
    };
  }

  throw new Error(
    "Either Contact ID or Email is required."
  );
}
