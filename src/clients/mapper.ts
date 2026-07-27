import type { ClientRecord } from "../persistence/models/client";
import type { APIClient } from "./types";

export function mapClient(
  record: ClientRecord,
): APIClient {
 return {
  id: record.id,
  name: record.name,
  tenantId: record.tenant_id,

  // Temporary until auth migration completes
  apiKey: "",

  status: record.status as APIClient["status"],
  permissions: JSON.parse(record.permissions),
};
}