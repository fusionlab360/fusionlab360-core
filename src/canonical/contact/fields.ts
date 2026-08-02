export const ContactFields = {

  // ----------------------------------------
  // Basic
  // ----------------------------------------

  FirstName: "contact.firstName",
  LastName: "contact.lastName",

  Email: "contact.email",
  Phone: "contact.phone",

  // ----------------------------------------
  // Identity
  // ----------------------------------------

  Passport: "contact.passport",

  IdentityNumber: "contact.identityNumber",
  IdentityType: "contact.identityType",

  Nationality: "contact.nationality",

  DOB: "contact.dob",

  // ----------------------------------------
  // Address
  // ----------------------------------------

  Address: "contact.address",

  City: "contact.city",

  State: "contact.state",

  Country: "contact.country",

  PostalCode: "contact.postalCode",

} as const;

export type ContactField =
  typeof ContactFields[keyof typeof ContactFields];