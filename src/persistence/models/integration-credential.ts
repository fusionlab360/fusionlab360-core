export interface IntegrationCredential {
  tenantId: string;
  provider: string;

  apiKey: string;
  locationId: string;

  refreshToken?: string | null;
  metadata?: string | null;

  createdAt: string;
  updatedAt: string;
}