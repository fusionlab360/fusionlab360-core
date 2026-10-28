import type { D1Database } from "@cloudflare/workers-types";
import { generateApiKey } from "../../clients/generator";
import { hashApiKey } from "../../core/security/api-key";

export const SERVICE_CLIENT_PERMISSIONS = [
  "contacts:read",
  "integrations:test",
] as const;

const SERVICE_CLIENT_TENANT = "gmmetro";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

export interface ServiceClientProvisioningInput {
  tenantId: string;
  clientId: string;
  clientName: string;
  operatorIdentity: string;
}

export interface ServiceClientProvisioningResult {
  tenantId: string;
  clientId: string;
  permissions: readonly string[];
  apiKey: string;
}

export interface ServiceClientInspection {
  tenantId: string;
  clientId: string;
  status: string;
  permissions: string[];
  serviceMarker: boolean;
  contactsReadGrant: boolean;
}

function requireInput(input: ServiceClientProvisioningInput): void {
  if (input.tenantId !== SERVICE_CLIENT_TENANT) {
    throw new Error("This provisioning command is restricted to the approved gmmetro tenant.");
  }
  if (!IDENTIFIER_PATTERN.test(input.clientId) || input.clientId === "default") {
    throw new Error("A dedicated non-default client ID is required.");
  }
  if (!input.clientName.trim() || input.clientName.length > 200) {
    throw new Error("A client name is required.");
  }
  if (!input.operatorIdentity.trim() || input.operatorIdentity.length > 200) {
    throw new Error("An operator identity is required.");
  }
}

/**
 * Provision the bounded service identity atomically through D1 batch().
 * The plaintext API key is returned only to the caller and is never persisted.
 */
export async function provisionServiceClient(
  db: D1Database,
  input: ServiceClientProvisioningInput,
  keyGenerator: () => string = generateApiKey,
): Promise<ServiceClientProvisioningResult> {
  requireInput(input);

  const tenant = await db.prepare("SELECT id, status FROM tenants WHERE id=? LIMIT 1").bind(input.tenantId).first<{ id: string; status: string }>();
  if (!tenant || tenant.status !== "active") {
    throw new Error("The approved tenant is unavailable or inactive.");
  }

  const existingClient = await db.prepare("SELECT id FROM clients WHERE id=? LIMIT 1").bind(input.clientId).first<{ id: string }>();
  if (existingClient) {
    throw new Error("The requested client ID already exists; no partial identity was changed.");
  }

  const apiKey = keyGenerator();
  if (!apiKey.startsWith("fl360_") || apiKey.length < 20) {
    throw new Error("The API-key generator returned an invalid credential.");
  }
  const apiKeyHash = await hashApiKey(apiKey);

  await db.batch([
    db.prepare(`
      INSERT INTO clients (id, tenant_id, name, api_key_hash, status, permissions)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).bind(input.clientId, input.tenantId, input.clientName.trim(), apiKeyHash, JSON.stringify(SERVICE_CLIENT_PERMISSIONS)),
    db.prepare("INSERT INTO console_service_clients (client_id) VALUES (?)").bind(input.clientId),
    db.prepare("INSERT INTO client_tenant_grants (client_id, tenant_id, grant_scope) VALUES (?, ?, 'contacts:read')").bind(input.clientId, input.tenantId),
  ]);

  return {
    tenantId: input.tenantId,
    clientId: input.clientId,
    permissions: SERVICE_CLIENT_PERMISSIONS,
    apiKey,
  };
}

/** Read-only verification; never returns an API key or credential hash. */
export async function inspectServiceClient(
  db: D1Database,
  tenantId: string,
  clientId: string,
): Promise<ServiceClientInspection | null> {
  const row = await db.prepare(`
    SELECT c.tenant_id AS tenantId,
           c.id AS clientId,
           c.status,
           c.permissions,
           CASE WHEN s.client_id IS NULL THEN 0 ELSE 1 END AS serviceMarker,
           CASE WHEN g.client_id IS NULL THEN 0 ELSE 1 END AS contactsReadGrant
    FROM clients c
    LEFT JOIN console_service_clients s ON s.client_id=c.id
    LEFT JOIN client_tenant_grants g
      ON g.client_id=c.id AND g.tenant_id=c.tenant_id AND g.grant_scope='contacts:read'
    WHERE c.tenant_id=? AND c.id=?
    LIMIT 1
  `).bind(tenantId, clientId).first<{
    tenantId: string;
    clientId: string;
    status: string;
    permissions: string;
    serviceMarker: number;
    contactsReadGrant: number;
  }>();
  if (!row) return null;

  let permissions: unknown;
  try {
    permissions = JSON.parse(row.permissions);
  } catch {
    throw new Error("Stored client permissions are malformed.");
  }
  if (!Array.isArray(permissions) || permissions.some((value) => typeof value !== "string")) {
    throw new Error("Stored client permissions are malformed.");
  }
  return {
    tenantId: row.tenantId,
    clientId: row.clientId,
    status: row.status,
    permissions,
    serviceMarker: row.serviceMarker === 1,
    contactsReadGrant: row.contactsReadGrant === 1,
  };
}
