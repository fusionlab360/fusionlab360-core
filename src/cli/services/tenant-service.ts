import { buildInsertTenantSql } from "../sql/insert-tenant";
import { buildInsertIntegrationSql } from "../sql/insert-integration";
import {
  buildInsertPendingOAuthCredentialSql,
} from "../sql/insert-credentials";

import { generateId } from "../utils/id";
import { createClient } from "./client-service";

export interface CreateTenantInput {
  tenantId: string;
  tenantName: string;
  provider: string;
  companyId: string;
  locationId: string;
  permissions: string[];
}

export interface CreateTenantResult {
  sql: string;
  apiKey: string;
}

export async function createTenant(
  input: CreateTenantInput,
): Promise<CreateTenantResult> {
  const requiredFields = [
    ["Tenant ID", input.tenantId],
    ["Tenant name", input.tenantName],
    ["Provider", input.provider],
    ["GHL Company ID", input.companyId],
    ["GHL Location ID", input.locationId],
  ] as const;

  const missing = requiredFields.find(
    ([, value]) => !value.trim(),
  );

  if (missing) {
    throw new Error(`${missing[0]} is required.`);
  }

  if (input.provider !== "gohighlevel") {
    throw new Error(
      "OAuth-first tenant creation currently supports GoHighLevel only.",
    );
  }

  const tenantSql = buildInsertTenantSql({
    id: input.tenantId,
    name: input.tenantName,
    status: "inactive",
  });

  const integrationId = generateId();

  const integrationSql = buildInsertIntegrationSql({
    id: integrationId,
    tenantId: input.tenantId,
    provider: input.provider,
    enabled: false,
  });

  const credentialsSql = buildInsertPendingOAuthCredentialSql({
    tenantId: input.tenantId,
    provider: input.provider,
    companyId: input.companyId,
    locationId: input.locationId,
  });

  const client = await createClient({
    tenantId: input.tenantId,
    clientId: `${input.tenantId}-default`,
    clientName: "Default API Client",
    permissions: input.permissions,
  });

  return {
    sql: `
${tenantSql}

${integrationSql}

${credentialsSql}

${client.sql}
`,
    apiKey: client.apiKey,
  };
}