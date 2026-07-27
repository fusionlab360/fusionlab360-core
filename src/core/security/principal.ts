export type PrincipalType =
  | "client"
  | "user"
  | "service";

export interface AuthenticatedPrincipal {
  type: PrincipalType;

  tenantId: string;

  clientId?: string;

  userId?: string;

  role?: string;

  permissions: readonly string[];
}