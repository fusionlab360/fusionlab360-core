import type { ClientRecord } from "../persistence/models/client";
import type { APIClient } from "./types";

export function mapClient(
  record: ClientRecord,
): APIClient {
 const parsedPermissions: unknown = JSON.parse(record.permissions);
 if (
  !Array.isArray(parsedPermissions) ||
  parsedPermissions.some(
   (permission) => typeof permission !== "string" || !permission.trim(),
  )
 ) {
  throw new Error("Invalid API client permissions.");
 }

 return {
  id: record.id,
  name: record.name,
  tenantId: record.tenant_id,

  // Temporary until auth migration completes
  apiKey: "",

  status: record.status as APIClient["status"],
  permissions: parsedPermissions,
};
}
