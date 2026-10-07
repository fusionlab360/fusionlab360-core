
export interface InsertIntegrationInput {
  id: string;
  tenantId: string;
  provider: string;
}

export function buildInsertIntegrationSql(
  input: InsertIntegrationInput,
): string {

  return `
INSERT INTO integrations (
    id,
    tenant_id,
    provider,
    enabled
)
VALUES (
    '${input.id}',
    '${input.tenantId}',
    '${input.provider}',
    1
);
`;

}