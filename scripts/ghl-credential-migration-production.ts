import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCredentialCipher, decryptCredentialValue, integrationCredentialContext,
  oauthInstallationCredentialContext } from "../src/core/security/credential-storage";
import { CredentialRepository } from "../src/persistence/repositories/credential-repository";
import { OAuthInstallationRepository } from "../src/persistence/repositories/oauth-installation-repository";
import { countGhlCredentialCandidates, ghlCredentialStores, type GhlCredentialStore } from "./ghl-credential-migration-counts";

const target = {
  account: "298b73e651f29df3116dfe3a36234866",
  name: "fusionlab360-db",
  id: "e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4",
};
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${target.account}/d1/database/${target.id}`;
type Mode = "plan" | "apply" | "verify";
type ErrorCode = "INVALID_ARGUMENTS" | "TARGET_DENIED" | "TARGET_MISMATCH" | "API_TOKEN_REQUIRED" |
  "KEY_CONFIGURATION_INVALID" | "SCOPE_CHANGED" | "COUNTS_CHANGED" | "QUERY_DENIED" |
  "D1_RESPONSE_FAILED" | "VERIFICATION_FAILED" | "OPERATION_FAILED";
class OperatorError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

function options(args: string[]) {
  const spec = {
    account: { type: "string" }, database: { type: "string" }, "database-id": { type: "string" },
    store: { type: "string" }, mode: { type: "string" }, "key-version": { type: "string" },
    confirm: { type: "string" }, "expect-pending-fields": { type: "string" },
  } as const;
  let values;
  try {
    const parsed = parseArgs({ args, options: spec, tokens: true, strict: true, allowPositionals: false });
    if (new Set(parsed.tokens.map((token) => token.kind === "option" && token.name)).size !== parsed.tokens.length) {
      throw new Error();
    }
    values = parsed.values;
  } catch {
    throw new OperatorError("INVALID_ARGUMENTS");
  }
  if (values.account !== target.account || values.database !== target.name || values["database-id"] !== target.id) {
    throw new OperatorError("TARGET_DENIED");
  }
  const store = values.store;
  const mode = values.mode ?? "plan";
  const keyVersion = values["key-version"] ?? "";
  const expected = values["expect-pending-fields"];
  if ((store !== "locations" && store !== "installations") ||
      (mode !== "plan" && mode !== "apply" && mode !== "verify") ||
      (mode === "plan" ? !!keyVersion : !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) ||
      (mode === "apply"
        ? values.confirm !== target.id || !/^[0-6]$/.test(expected ?? "")
        : values.confirm !== undefined || expected !== undefined)) {
    throw new OperatorError("INVALID_ARGUMENTS");
  }
  return { store, mode, keyVersion, expected: Number(expected) } as const;
}

type ApiReply = { success?: boolean; result?: unknown };
type QueryReply = { success?: boolean; results?: unknown[]; meta?: { changes?: number } };

function connect(token: string, mode: Mode, fetcher: typeof fetch) {
  async function request(suffix: "" | "/query", body?: { sql: string; params: string[] }) {
    try {
      const response = await fetcher(endpoint + suffix, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error();
      const reply = await response.json() as ApiReply;
      if (reply.success !== true) throw new Error();
      return reply.result;
    } catch {
      // Provider responses and errors can contain SQL parameters or rows.
      throw new OperatorError("D1_RESPONSE_FAILED");
    }
  }

  function statement(sql: string, params: unknown[] = []) {
    async function query(write: boolean) {
      if (sql.includes(";") || (write ? mode !== "apply" || !/^UPDATE\s/i.test(sql.trim())
        : !/^SELECT\s/i.test(sql.trim()))) throw new OperatorError("QUERY_DENIED");
      // The Cloudflare REST API accepts string parameters. This release
      // requires populated token and ownership fields, so NULL is rejected.
      const bound = params.map((value) => {
        if (typeof value === "string") return value;
        if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
        throw new OperatorError("QUERY_DENIED");
      });
      const result = await request("/query", { sql, params: bound });
      const reply = Array.isArray(result) && result.length === 1 ? result[0] as QueryReply : null;
      if (reply?.success !== true || !Array.isArray(reply.results) ||
          (write && reply.meta?.changes !== 0 && reply.meta?.changes !== 1)) {
        throw new OperatorError("D1_RESPONSE_FAILED");
      }
      return reply;
    }
    return {
      bind: (...values: unknown[]) => statement(sql, values),
      first: async () => (await query(false)).results?.[0] ?? null,
      all: () => query(false),
      run: () => query(true),
    };
  }
  return {
    async verifyTarget() {
      const metadata = await request("") as { uuid?: string; name?: string } | null;
      if (metadata?.uuid !== target.id || metadata.name !== target.name) throw new OperatorError("TARGET_MISMATCH");
    },
    // The existing migration methods need only prepare/bind/first/all/run.
    db: { prepare: statement } as unknown as D1Database,
  };
}

async function assertScope(db: D1Database, store: GhlCredentialStore) {
  const { table, access, category, kind, rows } = ghlCredentialStores[store];
  const identity = store === "locations"
    ? "NULLIF(TRIM(tenant_id), '') IS NOT NULL AND NULLIF(TRIM(location_id), '') IS NOT NULL"
    : "NULLIF(TRIM(external_account_id), '') IS NOT NULL";
  const row = await db.prepare(`
    SELECT COUNT(*) AS rows, SUM(CASE WHEN ${category} = ? AND ${identity} AND
      NULLIF(TRIM(${access}), '') IS NOT NULL AND NULLIF(TRIM(refresh_token), '') IS NOT NULL
      THEN 1 ELSE 0 END) AS expected
    FROM ${table} WHERE provider = 'gohighlevel'
  `).bind(kind).first<{ rows: number; expected: number }>();
  if (row?.rows !== rows || row.expected !== rows) throw new OperatorError("SCOPE_CHANGED");
}

async function verifyEncryptedFields(db: D1Database, store: GhlCredentialStore,
  cipher: ReturnType<typeof createCredentialCipher>) {
  const location = store === "locations";
  const { table, access, rows } = ghlCredentialStores[store];
  const identity = location ? "tenant_id AS owner, location_id AS location" : "external_account_id AS owner, NULL AS location";
  const result = await db.prepare(`
    SELECT ${identity}, ${access} AS access, refresh_token AS refresh
    FROM ${table} WHERE provider = 'gohighlevel' LIMIT ?
  `).bind(rows + 1).all<{ owner: string; location: string | null; access: string; refresh: string }>();
  try {
    if (result.results.length !== rows) throw new Error();
    for (const row of result.results) {
      for (const field of ["access", "refresh"] as const) {
        const context = location
          ? integrationCredentialContext(row.owner, "gohighlevel", row.location, field)
          : oauthInstallationCredentialContext("gohighlevel", "company", row.owner, field);
        if (!row[field] || !await decryptCredentialValue(cipher, context, row[field])) throw new Error();
      }
    }
  } catch {
    throw new OperatorError("VERIFICATION_FAILED");
  }
  return rows * 2;
}

export async function runProductionCredentialMigration(
  args: string[],
  secrets: { token?: string; keyring?: string },
  fetcher: typeof fetch = fetch,
) {
  try {
    const { store, mode, keyVersion, expected } = options(args);
    if (!secrets.token?.trim()) throw new OperatorError("API_TOKEN_REQUIRED");
    let cipher;
    if (mode !== "plan") {
      try {
        cipher = createCredentialCipher({
          CORE_CREDENTIAL_ENCRYPTION_KEYS: secrets.keyring,
          CORE_CREDENTIAL_ACTIVE_KEY_VERSION: keyVersion,
        });
      } catch {
        throw new OperatorError("KEY_CONFIGURATION_INVALID");
      }
    }
    const { db, verifyTarget } = connect(secrets.token, mode, fetcher);
    await verifyTarget();
    await assertScope(db, store);
    const before = await countGhlCredentialCandidates(db, store);
    if (mode === "plan") return { ok: true, store, mode, counts: before } as const;
    if (!cipher) throw new OperatorError("KEY_CONFIGURATION_INVALID");
    if (mode === "verify") {
      if (before.pendingFields !== 0) throw new OperatorError("VERIFICATION_FAILED");
      const verifiedFields = await verifyEncryptedFields(db, store, cipher);
      await assertScope(db, store);
      const after = await countGhlCredentialCandidates(db, store);
      if (after.pendingFields !== 0) throw new OperatorError("COUNTS_CHANGED");
      return { ok: true, store, mode, counts: after, verifiedFields } as const;
    }
    if (before.pendingFields !== expected) throw new OperatorError("COUNTS_CHANGED");
    const storage = { cipher, allowLegacyPlaintextReads: false };
    const convertedRows = before.pendingFields === 0 ? 0 : store === "locations"
      ? await new CredentialRepository(db, storage).migratePlaintextBatch(1, "oauth2")
      : await new OAuthInstallationRepository(db, storage).migratePlaintextBatch(1, "company");
    await assertScope(db, store);
    const after = await countGhlCredentialCandidates(db, store);
    const checkpoint = after.pendingFields === 0 ? "complete" : convertedRows === 0 ? "recount_required" : "pending";
    return { ok: true, store, mode, before, convertedRows, after, checkpoint } as const;
  } catch (error) {
    return { ok: false, code: error instanceof OperatorError ? error.code : "OPERATION_FAILED" } as const;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runProductionCredentialMigration(process.argv.slice(2), {
    token: process.env.FL360_P01_D1_API_TOKEN,
    keyring: process.env.CORE_CREDENTIAL_ENCRYPTION_KEYS,
  }).then((result) => {
    console.log(JSON.stringify(result));
    if (!result.ok || ("checkpoint" in result && result.checkpoint === "recount_required")) process.exitCode = 1;
  });
}
