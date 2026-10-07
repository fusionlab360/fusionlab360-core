interface InsertTenantInput {
  id: string;
  name: string;
}

export function buildInsertTenantSql(
  input: InsertTenantInput,
): string {

  return `
INSERT INTO tenants (
    id,
    name,
    status
)
VALUES (
    '${input.id}',
    '${input.name}',
    'active'
);
`;

}