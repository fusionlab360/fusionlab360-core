import { sqlLiteral } from "./literal";

interface InsertClientInput {
  tenantId: string;
  clientId: string;
  clientName: string;
  apiKeyHash: string;
  permissions: string[];
}

export function buildInsertClientSql(
  input: InsertClientInput,
): string {
  const permissions = JSON.stringify(input.permissions);

  return `
INSERT INTO clients (
  id,
  tenant_id,
  name,
  api_key_hash,
  status,
  permissions
)
VALUES (
  ${sqlLiteral(input.clientId)},
  ${sqlLiteral(input.tenantId)},
  ${sqlLiteral(input.clientName)},
  ${sqlLiteral(input.apiKeyHash)},
  'active',
  ${sqlLiteral(permissions)}
);
`;
}