import type { RequestContext } from "../../context";

import { logger } from "../../core/logger";
import { resolveCRMAdapter } from "../../core/crm";

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

/** Create or update a contact using the tenant's CRM adapter. */
export async function createContactService(
  context: RequestContext,
  payload: CreateContactRequest
) {
  const crm = resolveCRMAdapter(context.tenant);
  const snapshot = readContactSnapshot(context, "contact.create", payload);
  const savedContact = await crm.upsertContact(context, {
    ...payload,
    ...(snapshot.kind === "blank" ? { notes: undefined } : {}),
    ...(snapshot.kind === "complete" ? { events: snapshot.events } : {}),
  });
  await syncCompleteContactSnapshot(context, crm, savedContact, snapshot);
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
  payload: Partial<CreateContactRequest>
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
  await syncCompleteContactSnapshot(context, crm, updatedContact, snapshot);

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
