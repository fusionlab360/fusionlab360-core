export const ghlCredentialStores = {
  locations: { table: "integration_credentials", access: "api_key", category: "auth_type", kind: "oauth2", rows: 3 },
  installations: { table: "oauth_installations", access: "access_token", category: "account_type", kind: "company", rows: 1 },
} as const;

export type GhlCredentialStore = keyof typeof ghlCredentialStores;
type Counts = { rows: number; pendingRows: number; pendingFields: number };

export async function countGhlCredentialCandidates(db: D1Database, store: GhlCredentialStore): Promise<Counts> {
  const { table, access } = ghlCredentialStores[store];
  const pending = (field: string) =>
    `CASE WHEN ${field} IS NOT NULL AND ${field} <> '' AND ${field} NOT LIKE 'fl360enc:%' THEN 1 ELSE 0 END`;
  const row = await db.prepare(`
    SELECT COUNT(*) AS rows,
      COALESCE(SUM(CASE WHEN (${pending(access)}) + (${pending("refresh_token")}) > 0
        THEN 1 ELSE 0 END), 0) AS pendingRows,
      COALESCE(SUM((${pending(access)}) + (${pending("refresh_token")})), 0) AS pendingFields
    FROM ${table} WHERE provider = 'gohighlevel'
  `).first<Counts>();
  if (!row || [row.rows, row.pendingRows, row.pendingFields].some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error("Invalid migration counts");
  }
  return row;
}
