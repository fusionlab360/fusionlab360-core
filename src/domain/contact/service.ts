import type { RequestContext } from "../../context";

import { resolveCRMAdapter } from "../../core/crm";

import type { CreateContactRequest } from "./schemas";
import type { Contact } from "../../core/crm/models/contact";

/**
 * Create or update a contact.
 * The adapter decides how this is implemented.
 */
export async function createContactService(
  context: RequestContext,
  payload: CreateContactRequest
) {
  const crm = resolveCRMAdapter(context.tenant);

  return crm.upsertContact(
    context,
    payload as Contact
  );
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

  return crm.updateContact(
    context,
    payload.id,
    payload as Partial<Contact>
  );
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