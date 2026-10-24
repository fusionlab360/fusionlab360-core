import type { RequestContext } from "../../context";

import { logger } from "../../core/logger";
import { resolveCRMAdapter } from "../../core/crm";

import type { CreateContactRequest } from "./schemas";

import { parseContactEvents } from "./event-parser";

import type { Contact } from "../../core/crm/models/contact";

import type { ContactEvent } from "./event";

function errorCategory(error: unknown): string {
  if (error instanceof TypeError) return "type_error";
  if (error instanceof RangeError) return "range_error";
  if (error instanceof SyntaxError) return "syntax_error";
  return error instanceof Error ? "error" : "unknown";
}

/**
 * Create or update a contact.
 * The adapter decides how this is implemented.
 */
export async function createContactService(
  context: RequestContext,
  payload: CreateContactRequest
) {
  const crm = resolveCRMAdapter(context.tenant);

const events =
  parseContactEvents(
    payload.notes,
  );

logger.info("Contact events parsed", {
  operation: "contact.create",
  provider: context.tenant.integrations.crm.provider,
  correlationId: context.requestId,
  notesProvided: Boolean(payload.notes?.trim()),
  eventCount: events.length,
});

  const contact: Contact = {
    ...payload,
    events,
  };

    const savedContact =
    await crm.upsertContact(
      context,
      contact,
    );

    if (savedContact.id) {
  try {
    await crm.syncContactEvents(
      context,
      {
        contactId: savedContact.id,
        events,
      },
    );
  } 
  catch (error) {
    logger.error("Contact event synchronization failed", {
      operation: "contact.events.sync",
      provider: context.tenant.integrations.crm.provider,
      correlationId: context.requestId,
      outcome: "failed",
      errorCategory: errorCategory(error),
    });
  }
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
  payload: Partial<CreateContactRequest>
) {
  const crm = resolveCRMAdapter(context.tenant);

  if (!payload.id) {
    throw new Error("Contact ID is required.");
  }

  const contactUpdate: Partial<Contact> = {
    ...payload,
  };

  let events: ContactEvent[] | undefined;

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "notes",
    )
  ) {
    events = parseContactEvents(
      payload.notes,
    );

    logger.info("Contact events parsed", {
      operation: "contact.update",
      provider: context.tenant.integrations.crm.provider,
      correlationId: context.requestId,
      notesProvided: Boolean(payload.notes?.trim()),
      eventCount: events.length,
    });

    contactUpdate.events = events;
  }

  const updatedContact =
    await crm.updateContact(
      context,
      payload.id,
      contactUpdate,
    );

  if (events !== undefined && updatedContact.id) {
  try {
    await crm.syncContactEvents(
      context,
      {
        contactId: updatedContact.id,
        events,
      },
    );
  } catch (error) {
    logger.error("Contact event synchronization failed", {
      operation: "contact.events.sync",
      provider: context.tenant.integrations.crm.provider,
      correlationId: context.requestId,
      outcome: "failed",
      errorCategory: errorCategory(error),
    });
  }
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
