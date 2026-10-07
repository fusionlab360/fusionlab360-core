import { buildInsertTenantSql } from "../sql/insert-tenant";
import { buildInsertIntegrationSql } from "../sql/insert-integration";
import { buildInsertCredentialsSql } from "../sql/insert-credentials";

import { generateId } from "../utils/id";

import { createClient } from "./client-service";

export interface CreateTenantInput {
  tenantId: string;
  tenantName: string;

  provider: string;

  apiKey: string;
  locationId: string;
}

export interface CreateTenantResult {
  sql: string;
  apiKey: string;
}

export async function createTenant(
  input: CreateTenantInput,
): Promise<CreateTenantResult> {

  console.log("Creating tenant...");

  const tenantSql = buildInsertTenantSql({
    id: input.tenantId,
    name: input.tenantName,
  });

  const integrationId = generateId();

  console.log(
    "Creating integration:",
    integrationId,
  );

  const integrationSql =
    buildInsertIntegrationSql({
      id: integrationId,
      tenantId: input.tenantId,
      provider: input.provider,
    });

  const credentialsSql =
    buildInsertCredentialsSql({
      tenantId: input.tenantId,
      provider: input.provider,
      apiKey: input.apiKey,
      locationId: input.locationId,
    });

  const clientId = `${input.tenantId}-default`;

const client =
  await createClient({
    tenantId: input.tenantId,
    clientId,
    clientName: "Default API Client",
  });

  const sqlBatch = `
${tenantSql}

${integrationSql}

${credentialsSql}

${client.sql}
`;

  return {
    sql: sqlBatch,
    apiKey: client.apiKey,
  };
}