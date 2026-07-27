export type ClientStatus = "active" | "inactive";

export interface APIClient {
  id: string;

  name: string;

  tenantId: string;

  apiKey: string;

  status: ClientStatus;

  permissions: string[];
}