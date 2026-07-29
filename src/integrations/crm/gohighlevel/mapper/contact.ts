import type { Contact } from "../../../../core/crm/models/contact";
import type { GHLContact } from "../types";

// Platform -> GoHighLevel
export function toGHLContact(
  contact: Contact
): GHLContact {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,

    identityNumber: contact.identityNumber,
    identityType: contact.identityType,
    nationality: contact.nationality,
    dob: contact.dob,
  };
}

// Platform Partial -> GoHighLevel Partial
export function toGHLPartialContact(
  contact: Partial<Contact>
): Partial<GHLContact> {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,

    identityNumber: contact.identityNumber,
    identityType: contact.identityType,
    nationality: contact.nationality,
    dob: contact.dob,
  };
}

// GoHighLevel -> Platform
export function fromGHLContact(
  contact: GHLContact
): Contact {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,

    identityNumber: contact.identityNumber,
    identityType: contact.identityType,
    nationality: contact.nationality,
    dob: contact.dob,
  };
}