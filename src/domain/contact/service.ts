import type { RequestContext } from "../../context";

import { resolveCRMAdapter } from "../../core/crm";

import type { CreateContactRequest } from "./schemas";

import { parseContactEvents } from "./event-parser";

import type { Contact } from "../../core/crm/models/contact";

import type { ContactEvent } from "./event";

/**
 * Create or update a contact.
 * The adapter decides how this is implemented.
 */
export async function createContactService(
  context: RequestContext,
  payload: CreateContactRequest
) {
  const crm = resolveCRMAdapter(context.tenant);

 console.log(
  "CONTACT NOTES RAW",
  {
    notes:
      payload.notes,
  },
);

const events =
  parseContactEvents(
    payload.notes,
  );

console.log(
  "CONTACT EVENTS PARSED",
  events,
);

  const contact: Contact = {
    ...payload,
    events,
  };

    const savedContact =
    await crm.upsertContact(
      context,
      contact,
    );

    console.log(
  "CONTACT EVENT SYNC CALL",
  {
    contactId:
      savedContact.id,

    eventCount:
      events.length,

    events,
  },
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
    console.error(
      "Contact event synchronization failed:",
      error,
    );
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

    console.log(
  "CONTACT EVENTS PARSED ON UPDATE",
  JSON.stringify(
    events,
    null,
    2,
  ),
);

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
    console.error(
      "Contact event synchronization failed:",
      error,
    );
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