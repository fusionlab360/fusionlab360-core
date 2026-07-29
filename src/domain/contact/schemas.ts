export interface CreateContactRequest {
  id?: string;

  firstName: string;
  lastName?: string;

  email?: string;
  phone?: string;

  identityNumber?: string;
  identityType?: string;

  nationality?: string;
}