export interface User {
  id: string;
  tenantId: string;
  clientId: string;

  email: string;
  passwordHash: string;

  firstName: string;
  lastName: string;

  role: string;
  permissions: string[];

  active: boolean;
}