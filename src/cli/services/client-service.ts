import { generateApiKey } from "../../clients/generator";
import { hashApiKey } from "../../core/security/api-key";

import { buildInsertClientSql } from "../sql/insert-client";

export interface CreateClientInput {
  tenantId: string;
  clientId: string;
  clientName: string;
  permissions: string[];
}

export interface CreateClientResult {
  apiKey: string;
  sql: string;
}

export async function createClient(
  input: CreateClientInput,
): Promise<CreateClientResult> {
  if (
    !input.tenantId.trim() ||
    !input.clientId.trim() ||
    !input.clientName.trim()
  ) {
    throw new Error(
      "Tenant ID, Client ID, and Client Name are required.",
    );
  }

  if (!Array.isArray(input.permissions)) {
    throw new Error("Client permissions must be explicitly supplied.");
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  const sql = buildInsertClientSql({
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientName: input.clientName,
    apiKeyHash,
    permissions: input.permissions,
  });

  return { apiKey, sql };
}