import type { RequestContext } from "../../../../context";
import type { Contact } from "../../../../core/crm/models/contact";
import type { GHLContact } from "../types";

import {
  tryResolveFieldMapping,
} from "../../../../core/crm/field-mapping";

import { ContactFields } from "../../../../canonical/contact";

/**
 * Returns a trimmed string or undefined.
 */
function clean(value?: string): string | undefined {

  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0
    ? trimmed
    : undefined;

}

/**
 * Returns a normalized email if valid.
 */
function cleanEmail(email?: string): string | undefined {

  const value = clean(email);

  if (!value) {
    return undefined;
  }

  const normalized =
    value.toLowerCase();

  const emailRegex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return emailRegex.test(normalized)
    ? normalized
    : undefined;

}

/**
 * Returns a normalized phone number.
 */
function cleanPhone(phone?: string): string | undefined {

  const value = clean(phone);

  if (!value) {
    return undefined;
  }

  const normalized =
    value.replace(/[^\d+]/g, "");

  return normalized.length > 0
    ? normalized
    : undefined;

}

interface CustomFieldValue {
  id: string;
  field_value: string;
}

function addField(
  fields: CustomFieldValue[],
  mapping: ReturnType<typeof tryResolveFieldMapping>,
  value: unknown,
) {

  if (!mapping) {
    return;
  }

  fields.push({
    id: mapping.providerFieldId,
    field_value:
      value == null
        ? ""
        : String(value),
  });

}

/**
 * Partial Contact -> Partial GHL Contact
 */
export function toGHLPartialContact(
  contact: Partial<Contact>,
): Partial<GHLContact> {

  const result: Partial<GHLContact> = {};

  const firstName = clean(contact.firstName);
  if (firstName) {
    result.firstName = firstName;
  }

  const lastName = clean(contact.lastName);
  if (lastName) {
    result.lastName = lastName;
  }

  const email = cleanEmail(contact.email);
  if (email) {
    result.email = email;
  }

  const phone = cleanPhone(contact.phone);
  if (phone) {
    result.phone = phone;
  }

  const address = clean(contact.address);
  if (address) {
    result.address1 = address;
  }

  const city = clean(contact.city);
  if (city) {
    result.city = city;
  }

  const state = clean(contact.state);
  if (state) {
    result.state = state;
  }

  const country = clean(contact.country);
  if (country) {
    result.country = country;
  }

  const postalCode = clean(contact.postalCode);
  if (postalCode) {
    result.postalCode = postalCode;
  }

  if (contact.dob) {
    result.dateOfBirth = contact.dob;
  }

  return result;
}

/**
 * Canonical Contact -> GoHighLevel Contact
 *
 * Standard GoHighLevel fields are mapped directly.
 * Provider-specific fields are mapped through
 * attribute mappings as custom fields.
 */


export function toGHLContact(
  _context: RequestContext,
  contact: Contact,
): GHLContact {

  const result: Partial<GHLContact> = {};

  if (contact.id) {
    result.id = contact.id;
  }

  result.firstName =
    clean(contact.firstName) ??
    "Guest";

  const lastName =
    clean(contact.lastName);

  if (lastName) {
    result.lastName = lastName;
  }

  const email =
    cleanEmail(contact.email);

  if (email) {
    result.email = email;
  }

  const phone =
    cleanPhone(contact.phone);

  if (phone) {
  result.phone = phone;
}

const address = clean(contact.address);
if (address) {
  result.address1 = address;
}

const city = clean(contact.city);
if (city) {
  result.city = city;
}

const state = clean(contact.state);
if (state) {
  result.state = state;
}

const country = clean(contact.country);
if (country) {
  result.country = country;
}

const postalCode = clean(contact.postalCode);
if (postalCode) {
  result.postalCode = postalCode;
}

if (contact.dob) {
  result.dateOfBirth = contact.dob;
}


  const customFields: CustomFieldValue[] = [];

// Identity Number
addField(
  customFields,
  tryResolveFieldMapping(
    _context,
    ContactFields.IdentityNumber,
  ),
  contact.identityNumber,
);

// Identity Type
addField(
  customFields,
  tryResolveFieldMapping(
    _context,
    ContactFields.IdentityType,
  ),
  contact.identityType,
);

// Nationality
addField(
  customFields,
  tryResolveFieldMapping(
    _context,
    ContactFields.Nationality,
  ),
  contact.nationality,
);



  if (customFields.length > 0) {
  result.customFields = customFields;
}

// TEMP DEBUG
console.log("===== GHL CONTACT PAYLOAD =====");
console.log(JSON.stringify(result, null, 2));

  return result as GHLContact;

}
/**
 * GoHighLevel -> Canonical Contact
 */
export function fromGHLContact(
  contact: GHLContact,
): Contact {

  return {

    id:
      contact.id ?? "",

    firstName:
      contact.firstName ?? "",

    lastName:
      contact.lastName ?? "",

    email:
      contact.email ?? "",

    phone:
      contact.phone ?? "",

    passport: "",

    identityNumber: "",
    identityType: "",

    nationality: "",

    address: "",
    city: "",
    state: "",
    country: "",
    postalCode: "",

    dob: "",

  };

}