export interface IntegrationRecord {
  id: string;
  tenant_id: string;
  provider: string;
  enabled: number;
  settings: string | null;
  created_at: string;
  updated_at: string;
}