
import { ClientRepository } from "../persistence/repositories/client-repository";
import { mapClient } from "./mapper";

import type { APIClient } from "./types";
import {
  LEGACY_WILDCARD_PERMISSION,
  parsePermissionScopes,
} from "./permissions";
import type { ClientRecord } from "../persistence/models/client";

export interface ClientPermissionSnapshot {
  id: string;
  name: string;
  tenantId: string;
  status: APIClient["status"];
  permissions: string[];
}

function mapPermissionSnapshot(record: ClientRecord | undefined): ClientPermissionSnapshot {
  if (!record) {
    throw new Error("Client was not found for the specified tenant.");
  }

  const permissions: unknown = JSON.parse(record.permissions);
  if (
    !Array.isArray(permissions) ||
    permissions.some((permission) => typeof permission !== "string" || !permission.trim())
  ) {
    throw new Error("Client permissions are malformed; refusing to update them.");
  }

  return {
    id: record.id,
    name: record.name,
    tenantId: record.tenant_id,
    status: record.status as APIClient["status"],
    permissions,
  };
}

export async function inspectClientPermissions(
  db: D1Database,
  tenantId: string,
  clientId: string,
): Promise<ClientPermissionSnapshot> {
  const repository = new ClientRepository(db);
  return mapPermissionSnapshot(
    await repository.findByTenantAndId(tenantId, clientId),
  );
}

export async function updateClientPermissions(
  db: D1Database,
  tenantId: string,
  clientId: string,
  action: "grant" | "revoke",
  requestedScopes: readonly string[],
): Promise<{ client: ClientPermissionSnapshot; added: string[]; removed: string[] }> {
  const scopes = parsePermissionScopes(requestedScopes, {
    allowLegacyWildcardRevocation: action === "revoke",
  });
  if (action === "grant" && scopes.includes(LEGACY_WILDCARD_PERMISSION)) {
    throw new Error("The wildcard permission cannot be granted.");
  }
  const repository = new ClientRepository(db);
  const record = await repository.findByTenantAndId(tenantId, clientId);
  if (!record) {
    throw new Error("Client was not found for the specified tenant.");
  }
  const client = mapPermissionSnapshot(record);
  const before = client.permissions;
  const beforeSet = new Set(before);
  const scopeSet = new Set<string>(scopes);
  const next = action === "grant"
    ? [...new Set([...before, ...scopes])]
    : before.filter((permission) => !scopeSet.has(permission));
  const added = action === "grant"
    ? scopes.filter((scope) => !beforeSet.has(scope))
    : [];
  const removed = action === "revoke"
    ? scopes.filter((scope) => beforeSet.has(scope))
    : [];

  if (added.length === 0 && removed.length === 0) {
    return { client: { ...client, permissions: next }, added, removed };
  }

  const updated = await repository.updatePermissions(
    tenantId,
    clientId,
    record.permissions,
    JSON.stringify(next),
  );
  if (!updated) {
    throw new Error("Client permissions changed concurrently; inspect and retry.");
  }

  return { client: { ...client, permissions: next }, added, removed };
}

export async function authenticateClient(
  db: D1Database,
  apiKeyHash: string,
): Promise<APIClient> {

  const repository = new ClientRepository(db);

  const record = await repository.findByApiKeyHash(
    apiKeyHash,
  );

  if (!record) {
    throw new Error("Invalid API client.");
  }

  const client = mapClient(record);

  if (client.status !== "active") {
    throw new Error("API client is inactive.");
  }

  return client;
}

export async function resolveActiveClientById(
  db: D1Database,
  clientId: string,
): Promise<APIClient> {
  const repository = new ClientRepository(db);
  const record = await repository.findById(clientId);

  if (!record) {
    throw new Error("Invalid API client.");
  }

  const client = mapClient(record);
  if (client.status !== "active") {
    throw new Error("API client is inactive.");
  }

  return client;
}
