import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { generateApiKey } from "../../clients/generator";
import {
  parsePermissionScopes,
  type PermissionScope,
} from "../../clients/permissions";
import { hashApiKey } from "../../core/security/api-key";
import { buildInsertClientSql } from "../sql/insert-client";
import { sqlLiteral } from "../sql/literal";

// This is the database_name in wrangler.jsonc env.dev, not the legacy remote CLI name.
export const LOCAL_CORE_DATABASE = "fusionlab360";
export const LOCAL_CORE_API_BASE_URL = "http://127.0.0.1:8787";
export const LOCAL_CONSOLE_ROOT = "D:\\Important Fusion Migration\\fusionlab360-console";

export const LOCAL_CONSOLE_SERVICE_PERMISSIONS = [
  "tenants:provision",
  "tenants:read",
  "contacts:read",
  "messaging:read",
  "messaging:send",
] as const satisfies readonly PermissionScope[];

export interface LocalClientProvisioningInput {
  tenantId: string;
  clientId: string;
  clientName: string;
  persistTo: string;
  database?: string;
  coreRoot?: string;
  wranglerPath?: string;
  local?: boolean;
  consoleRoot?: string;
  consoleApiDevVarsPath?: string;
}

export interface LocalClientProvisioningResult {
  apiKey: string;
  permissions: readonly PermissionScope[];
  tenantId: string;
  clientId: string;
}

export interface LocalD1CommandConfig {
  database: string;
  persistTo: string;
  cwd: string;
  wranglerPath: string;
}

export type LocalD1Executor = (
  sql: string,
  config: LocalD1CommandConfig,
) => string;

export type LocalDevVarsWriter = (
  path: string,
  apiKey: string,
) => void;

export function getLocalConsoleApiDevVarsPath(
  consoleRoot = LOCAL_CONSOLE_ROOT,
): string {
  return resolve(consoleRoot, "console-api", ".dev.vars");
}

export function parseLocalClientArguments(
  args: readonly string[],
): LocalClientProvisioningInput {
  const values = new Map<string, string>();
  let local = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--local") {
      local = true;
      continue;
    }
    if (["--remote", "--preview", "--env", "--target"].includes(argument)) {
      throw new Error("client:create-local only supports the explicit local target.");
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    if (values.has(argument)) {
      throw new Error(`${argument} may only be supplied once.`);
    }
    values.set(argument, value);
    index += 1;
  }

  const tenantId = values.get("--tenant");
  const clientId = values.get("--client");
  const clientName = values.get("--name");
  const persistTo = values.get("--persist-to");
  const consoleApiDevVarsPath = values.get("--write-console-api-dev-vars");

  if (!local) {
    throw new Error("client:create-local requires the explicit --local flag.");
  }
  if (!tenantId || !clientId || !clientName) {
    throw new Error("--tenant, --client, and --name are required.");
  }
  if (!persistTo) {
    throw new Error("--persist-to is required; refusing an implicit local database path.");
  }
  if (!consoleApiDevVarsPath) {
    throw new Error(
      "--write-console-api-dev-vars is required; refusing to provision without a secure local handoff.",
    );
  }

  return {
    tenantId,
    clientId,
    clientName,
    persistTo,
    database: values.get("--database") || LOCAL_CORE_DATABASE,
    coreRoot: values.get("--core-root"),
    local,
    consoleApiDevVarsPath,
  };
}

function sameWindowsPath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function validateLocalConsoleApiDevVarsPath(
  destinationPath: string,
  consoleRoot = LOCAL_CONSOLE_ROOT,
): { path: string; contents: string } {
  if (!destinationPath.trim() || !isAbsolute(destinationPath)) {
    throw new Error("Console API secret destination must be an absolute path.");
  }

  const destination = resolve(destinationPath);
  const expected = getLocalConsoleApiDevVarsPath(consoleRoot);
  if (!sameWindowsPath(destination, expected)) {
    throw new Error(
      "Refusing to write credentials outside the canonical local Console API .dev.vars file.",
    );
  }
  if (!existsSync(destination) || !statSync(destination).isFile()) {
    throw new Error("The canonical local Console API .dev.vars file must already exist.");
  }

  const contents = readFileSync(destination, "utf8");
  if (/^\s*CORE_SERVICE_TOKEN\s*=/m.test(contents)) {
    throw new Error(
      "CORE_SERVICE_TOKEN already exists; refusing to overwrite the local Console API credential.",
    );
  }
  const existingBaseUrl = contents.match(/^\s*CORE_API_BASE_URL\s*=\s*(.*?)\s*$/m)?.[1];
  if (existingBaseUrl && existingBaseUrl !== LOCAL_CORE_API_BASE_URL) {
    throw new Error(
      "The existing Console API Core URL is not the canonical local Core Worker URL.",
    );
  }

  return { path: destination, contents };
}

export function buildLocalConsoleApiDevVars(
  contents: string,
  apiKey: string,
): string {
  if (/^\s*CORE_SERVICE_TOKEN\s*=/m.test(contents)) {
    throw new Error("CORE_SERVICE_TOKEN already exists; refusing to overwrite it.");
  }
  const lineEnding = contents.includes("\r\n") ? "\r\n" : "\n";
  const prefix = contents.length === 0 || contents.endsWith("\n") ? "" : lineEnding;
  const baseUrl = /^\s*CORE_API_BASE_URL\s*=/m.test(contents)
    ? ""
    : `CORE_API_BASE_URL=${LOCAL_CORE_API_BASE_URL}${lineEnding}`;
  return `${contents}${prefix}${baseUrl}CORE_SERVICE_TOKEN=${apiKey}${lineEnding}`;
}

export function writeLocalConsoleApiDevVars(
  destinationPath: string,
  apiKey: string,
  consoleRoot = LOCAL_CONSOLE_ROOT,
): void {
  const destination = validateLocalConsoleApiDevVarsPath(destinationPath, consoleRoot);
  const updated = buildLocalConsoleApiDevVars(destination.contents, apiKey);
  writeFileSync(destination.path, updated, { encoding: "utf8", mode: 0o600 });
}

export function validateLocalClientInput(
  input: LocalClientProvisioningInput,
): LocalD1CommandConfig {
  if (input.local !== true) {
    throw new Error("Local target confirmation is required; no write was performed.");
  }
  if (!input.tenantId.trim() || !input.clientId.trim() || !input.clientName.trim()) {
    throw new Error("Tenant ID, Client ID, and Client Name are required.");
  }
  if (!input.persistTo.trim() || !isAbsolute(input.persistTo)) {
    throw new Error("--persist-to must be an absolute, existing directory.");
  }
  if (!existsSync(input.persistTo)) {
    throw new Error(`Local D1 persistence directory does not exist: ${input.persistTo}`);
  }

  const cwd = resolve(input.coreRoot || process.cwd());
  const wranglerPath = resolve(
    input.wranglerPath || join(cwd, "node_modules", "wrangler", "bin", "wrangler.js"),
  );
  if (!existsSync(wranglerPath)) {
    throw new Error(`Local Wrangler executable was not found: ${wranglerPath}`);
  }

  return {
    database: input.database?.trim() || LOCAL_CORE_DATABASE,
    persistTo: resolve(input.persistTo),
    cwd,
    wranglerPath,
  };
}

export function buildLocalD1Command(
  sqlFile: string,
  config: LocalD1CommandConfig,
): string[] {
  return [
    config.wranglerPath,
    "d1",
    "execute",
    config.database,
    "--local",
    "--persist-to",
    config.persistTo,
    "--yes",
    "--json",
    "--file",
    sqlFile,
  ];
}

export function executeLocalD1(
  sql: string,
  config: LocalD1CommandConfig,
  run = execFileSync,
): string {
  const tempFile = join(tmpdir(), `fusionlab360-local-${Date.now()}.sql`);
  writeFileSync(tempFile, sql, "utf8");
  try {
    const output = run(process.execPath, buildLocalD1Command(tempFile, config), {
      cwd: config.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    return String(output);
  } catch {
    throw new Error(
      "Local Core D1 execution failed. No local client credential was reported; verify Windows D1 access before retrying.",
    );
  } finally {
    try {
      unlinkSync(tempFile);
    } catch {
      // The temporary SQL file is best-effort cleanup only.
    }
  }
}

export function buildLocalPreflightSql(tenantId: string): string {
  return `
SELECT
  EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'clients') AS clients_present,
  EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'console_service_clients') AS service_identity_present,
  EXISTS (SELECT 1 FROM tenants WHERE id = ${sqlLiteral(tenantId)}) AS tenant_present;
`;
}

export function localPreflightAllowsProvisioning(
  output: string,
): boolean {
  try {
    const parsed: unknown = JSON.parse(output);
    const envelope = Array.isArray(parsed) ? parsed[0] : parsed;
    const results = envelope && typeof envelope === "object" && "results" in envelope
      ? (envelope as { results?: unknown }).results
      : undefined;
    const row = Array.isArray(results) ? results[0] : undefined;
    return row !== null && typeof row === "object" &&
      (row as Record<string, unknown>).clients_present === 1 &&
      (row as Record<string, unknown>).service_identity_present === 1 &&
      (row as Record<string, unknown>).tenant_present === 1;
  } catch {
    return false;
  }
}

export function buildLocalConsoleServiceClientSql(input: {
  tenantId: string;
  clientId: string;
  clientName: string;
  apiKeyHash: string;
  permissions: readonly PermissionScope[];
}): string {
  const clientSql = buildInsertClientSql({
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientName: input.clientName,
    apiKeyHash: input.apiKeyHash,
    permissions: [...input.permissions],
  });

  return `${clientSql}\nINSERT INTO console_service_clients (client_id) VALUES ('${input.clientId.replace(/'/g, "''")}');\n`;
}

export async function provisionLocalConsoleServiceClient(
  input: LocalClientProvisioningInput,
  execute: LocalD1Executor = executeLocalD1,
  writeDevVars?: LocalDevVarsWriter,
): Promise<LocalClientProvisioningResult> {
  const config = validateLocalClientInput(input);
  const destination = validateLocalConsoleApiDevVarsPath(
    input.consoleApiDevVarsPath || "",
    input.consoleRoot,
  );
  const permissions = parsePermissionScopes([...LOCAL_CONSOLE_SERVICE_PERMISSIONS])
    .filter((scope): scope is PermissionScope => scope !== "*");

  // Confirm local D1 access and the existing schema before generating a credential.
  try {
    const preflightOutput = execute(buildLocalPreflightSql(input.tenantId), config);
    if (!localPreflightAllowsProvisioning(preflightOutput)) {
      throw new Error("The requested local tenant or Console service schema is unavailable.");
    }
  } catch {
    throw new Error(
      "Local Core D1 preflight failed. No local client credential was generated or persisted.",
    );
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  try {
    execute(
      buildLocalConsoleServiceClientSql({
        tenantId: input.tenantId,
        clientId: input.clientId,
        clientName: input.clientName,
        apiKeyHash,
        permissions,
      }),
      config,
    );
  } catch {
    throw new Error(
      "Local Core D1 insert failed. The generated credential was not reported; inspect local D1 state before retrying.",
    );
  }

  try {
    (writeDevVars || ((path, key) => writeLocalConsoleApiDevVars(path, key, input.consoleRoot)))
      (destination.path, apiKey);
  } catch {
    throw new Error(
      "The Core client was persisted, but the Console API local secret handoff failed. The credential was not printed.",
    );
  }

  return {
    apiKey,
    permissions,
    tenantId: input.tenantId,
    clientId: input.clientId,
  };
}
