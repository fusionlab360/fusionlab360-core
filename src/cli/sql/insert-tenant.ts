import { sqlLiteral } from "./literal";

export interface InsertTenantInput {
  id: string;
  name: string;
  status?: "active" | "inactive";
}

export function buildInsertTenantSql(
  input: InsertTenantInput,
): string {
  const status = input.status ?? "active";

  return `
INSERT INTO tenants (
  id,
  name,
  status
)
VALUES (
  ${sqlLiteral(input.id)},
  ${sqlLiteral(input.name)},
  ${sqlLiteral(status)}
);
`;
}