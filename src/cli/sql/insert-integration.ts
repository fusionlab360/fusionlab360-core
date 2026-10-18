import { sqlLiteral } from "./literal";

export interface InsertIntegrationInput {
  id: string;
  tenantId: string;
  provider: string;
  enabled?: boolean;
}

export function buildInsertIntegrationSql(
  input: InsertIntegrationInput,
): string {
  const enabled = input.enabled === false ? 0 : 1;

  return `
INSERT INTO integrations (
  id,
  tenant_id,
  provider,
  enabled
)
VALUES (
  ${sqlLiteral(input.id)},
  ${sqlLiteral(input.tenantId)},
  ${sqlLiteral(input.provider)},
  ${enabled}
);
`;
}