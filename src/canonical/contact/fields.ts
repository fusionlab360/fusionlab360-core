export const ContactFields = {
  FirstName: "contact.firstName",
  LastName: "contact.lastName",
  Email: "contact.email",
  Phone: "contact.phone",
  PassportNoIC: "contact.passportNoIC",
  Nationality: "contact.nationality",
  DOB: "contact.dob",
} as const;

export type ContactField =
  typeof ContactFields[keyof typeof ContactFields];