import { generateApiKey } from "../../clients/generator";
import { hashApiKey } from "../../core/security/api-key";

import { buildInsertClientSql } from "../sql/insert-client";

export interface CreateClientInput {
  tenantId: string;
  clientId: string;
  clientName: string;
}

export interface CreateClientResult {
  apiKey: string;
  sql: string;
}

export async function createClient(
  input: CreateClientInput,
): Promise<CreateClientResult> {

  const apiKey = generateApiKey();

  const apiKeyHash = await hashApiKey(
    apiKey,
  );

  const sql = buildInsertClientSql({
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientName: input.clientName,
    apiKeyHash,
  });

  return {
  apiKey,
  sql,
};
}