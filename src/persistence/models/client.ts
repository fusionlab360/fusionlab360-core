export interface ClientRecord {
  id: string;
  tenant_id: string;

  name: string;

  api_key_hash: string;

  status: string;

  permissions: string;

  created_at: string;
  updated_at: string;
}