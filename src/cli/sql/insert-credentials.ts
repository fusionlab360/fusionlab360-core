export interface InsertCredentialsInput {
  tenantId: string;
  provider: string;
  apiKey: string;
  locationId: string;
}

export function buildInsertCredentialsSql(
  input: InsertCredentialsInput,
): string {

  return `
INSERT INTO integration_credentials (
    tenant_id,
    provider,
    api_key,
    location_id
)
VALUES (
    '${input.tenantId}',
    '${input.provider}',
    '${input.apiKey}',
    '${input.locationId}'
);
`;

}