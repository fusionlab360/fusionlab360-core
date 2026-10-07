export type IntegrationAuthType =
  | "api_key"
  | "oauth2";


export interface IntegrationCredential {
  tenantId: string;

  provider: string;

  authType:
    IntegrationAuthType;

  apiKey: string;

  locationId: string;

  refreshToken?:
    string | null;

  accessTokenExpiresAt?:
    number | null;

  refreshLockToken?:
    string | null;

  refreshLockExpiresAt?:
    number | null;

  metadata?:
    string | null;

  createdAt: string;

  updatedAt: string;
}