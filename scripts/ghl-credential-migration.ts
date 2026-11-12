import { lstat, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createCredentialStorageConfiguration } from "../src/core/security/credential-storage";
import { CredentialRepository } from "../src/persistence/repositories/credential-repository";
import { OAuthInstallationRepository } from "../src/persistence/repositories/oauth-installation-repository";
import { countGhlCredentialCandidates, type GhlCredentialStore } from "./ghl-credential-migration-counts";

type Target = { name: string; id: string };
type Options = Target & { store: GhlCredentialStore; batch: number; apply: boolean; keyVersion: string };
type FailureCode = "INVALID_ARGUMENTS" | "TARGET_DENIED" | "TARGET_UNAVAILABLE" |
  "INVALID_KEY_CONFIGURATION" | "MIGRATION_FAILED";

class MigrationError extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

const productionId = "e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4";
const localName = /^fl360-ghl-p01-rehearsal-[a-z0-9-]{1,32}$/;
const localId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertLocalTarget(target: Target): void {
  if (!localName.test(target.name) || !localId.test(target.id) || target.id === productionId) {
    throw new MigrationError("TARGET_DENIED");
  }
}

export function rehearsalDirectory(target: Target): string {
  assertLocalTarget(target);
  return join(tmpdir(), `fl360-ghl-p01-${target.id}`);
}

// Explicit local Miniflare options avoid loading Wrangler environments,
// remote bindings, or project dotenv files.
export async function openRehearsalDatabase(target: Target) {
  const directory = rehearsalDirectory(target);
  let persist: string;
  try {
    const base = await realpath(tmpdir());
    const actual = await realpath(directory);
    if (actual !== join(base, `fl360-ghl-p01-${target.id}`)) throw new Error();
    const marker = join(actual, "target.json");
    if (!(await lstat(marker)).isFile()) throw new Error();
    const expected = JSON.parse(await readFile(marker, "utf8"));
    if (expected?.name !== target.name || expected?.id !== target.id || expected?.synthetic !== true) {
      throw new Error();
    }
    persist = join(actual, "d1");
    if (!(await lstat(persist)).isDirectory() || await realpath(persist) !== persist) throw new Error();
  } catch {
    throw new MigrationError("TARGET_UNAVAILABLE");
  }
  const emulator = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response(null, { status: 404 }); } }",
    compatibilityDate: "2025-07-01",
    d1Databases: { DB: target.id },
    resourcePersistencePath: persist,
  }));
  try {
    const db = await emulator.getD1Database("DB") as unknown as D1Database;
    return { db, close: () => emulator.dispose() };
  } catch {
    await emulator.dispose().catch(() => undefined);
    throw new MigrationError("TARGET_UNAVAILABLE");
  }
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set(["--database-name", "--database-id", "--store", "--batch", "--key-version"]);
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--apply" && !apply) {
      apply = true;
      continue;
    }
    if (!flags.has(flag) || values.has(flag) || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new MigrationError("INVALID_ARGUMENTS");
    }
    values.set(flag, args[++i]);
  }
  const name = values.get("--database-name") ?? "";
  const id = values.get("--database-id") ?? "";
  const store = values.get("--store");
  const batchText = values.get("--batch") ?? "1";
  const batch = Number(batchText);
  const keyVersion = values.get("--key-version") ?? "";
  if (!name || !id || (store !== "locations" && store !== "installations") ||
      !/^\d+$/.test(batchText) || batch < 1 || batch > 50 ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) {
    throw new MigrationError("INVALID_ARGUMENTS");
  }
  assertLocalTarget({ name, id });
  return { name, id, store, batch, apply, keyVersion };
}

export async function runCredentialMigration(
  args: string[],
  keyring: string | undefined,
  open = openRehearsalDatabase,
) {
  try {
    const options = parseArgs(args);
    const { store } = options;
    let storage;
    if (options.apply) {
      try {
        storage = createCredentialStorageConfiguration({
          CORE_CREDENTIAL_ENCRYPTION_KEYS: keyring,
          CORE_CREDENTIAL_ACTIVE_KEY_VERSION: options.keyVersion,
        });
      } catch {
        throw new MigrationError("INVALID_KEY_CONFIGURATION");
      }
    }
    const { db, close } = await open({ name: options.name, id: options.id });
    try {
      const before = await countGhlCredentialCandidates(db, store);
      if (!storage) return { ok: true, store, checkpoint: "dry_run", before, convertedRows: 0, after: before } as const;
      const repository = store === "locations"
        ? new CredentialRepository(db, storage)
        : new OAuthInstallationRepository(db, storage);
      const convertedRows = await repository.migratePlaintextBatch(options.batch);
      const after = await countGhlCredentialCandidates(db, store);
      const checkpoint = after.pendingRows === 0 ? "complete" : convertedRows === 0 ? "retry_required" : "pending";
      return { ok: true, store, checkpoint, before, convertedRows, after } as const;
    } finally {
      await close();
    }
  } catch (error) {
    return { ok: false, code: error instanceof MigrationError ? error.code : "MIGRATION_FAILED" } as const;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCredentialMigration(process.argv.slice(2), process.env.CORE_CREDENTIAL_ENCRYPTION_KEYS).then((result) => {
    console.log(JSON.stringify(result));
    if (!result.ok || result.checkpoint === "retry_required") process.exitCode = 1;
  });
}
