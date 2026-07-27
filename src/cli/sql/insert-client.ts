interface InsertClientInput {
    tenantId: string;
    clientId: string;
    clientName: string;
    apiKeyHash: string;
}

export function buildInsertClientSql(
    input: InsertClientInput,
): string {
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
    '${input.clientId}',
    '${input.tenantId}',
    '${input.clientName}',
    '${input.apiKeyHash}',
    'active',
    '["*"]'
);
`;
}