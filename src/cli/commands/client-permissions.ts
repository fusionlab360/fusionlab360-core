import { getPlatformProxy } from "wrangler";

import {
  inspectClientPermissions,
  updateClientPermissions,
} from "../../clients/service";
import {
  LEGACY_WILDCARD_PERMISSION,
  parsePermissionScopes,
} from "../../clients/permissions";
import { info, title, success } from "../utils/output";

interface CLIEnvironment {
  DB: D1Database;
}

export interface ParsedClientPermissionArguments {
  action: "inspect" | "grant" | "revoke";
  tenantId: string;
  clientId: string;
  scopes: string[];
  environment?: string;
  remote: boolean;
  apply: boolean;
}

export function parseClientPermissionArguments(
  args: readonly string[],
): ParsedClientPermissionArguments {
  const action = args[0];
  if (action !== "inspect" && action !== "grant" && action !== "revoke") {
    throw new Error("Usage: client:permissions <inspect|grant|revoke> --tenant <id> --client <id> [--scope <scope>] [--env <name>] [--remote] [--apply --confirm <tenant/client>]");
  }

  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    if (argument === "--remote" || argument === "--apply") {
      if (flags.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
      flags.add(argument);
      continue;
    }
    if (!["--tenant", "--client", "--scope", "--env", "--confirm"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`A value is required for ${argument}.`);
    }
    if (argument !== "--scope" && values.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    values.set(argument, [...(values.get(argument) ?? []), value]);
    index += 1;
  }

  const tenantId = values.get("--tenant")?.[0];
  const clientId = values.get("--client")?.[0];
  const scopes = values.get("--scope") ?? [];
  const environment = values.get("--env")?.[0];
  const confirmation = values.get("--confirm")?.[0];
  if (
    !tenantId?.trim() ||
    !clientId?.trim() ||
    tenantId !== tenantId.trim() ||
    clientId !== clientId.trim()
  ) {
    throw new Error("Both --tenant and --client are required.");
  }
  if (action === "inspect" && (scopes.length > 0 || flags.has("--apply") || confirmation)) {
    throw new Error("Inspection does not accept scopes or mutation confirmation flags.");
  }
  if (action !== "inspect") {
    parsePermissionScopes(scopes, {
      allowLegacyWildcardRevocation: action === "revoke",
    });
    if (action === "grant" && scopes.includes(LEGACY_WILDCARD_PERMISSION)) {
      throw new Error("The wildcard permission cannot be granted.");
    }
  }
  const uniqueScopes = [...new Set(scopes)];
  if (flags.has("--apply") && confirmation !== `${tenantId}/${clientId}`) {
    throw new Error(`Mutation requires --confirm ${tenantId}/${clientId}.`);
  }
  if (!flags.has("--apply") && confirmation) {
    throw new Error("--confirm is only accepted together with --apply.");
  }

  return {
    action,
    tenantId,
    clientId,
    scopes: uniqueScopes,
    environment,
    remote: flags.has("--remote"),
    apply: flags.has("--apply"),
  };
}

export async function clientPermissionsCommand(
  args: readonly string[] = process.argv.slice(3),
): Promise<void> {
  const parsed = parseClientPermissionArguments(args);
  const target = parsed.environment
    ? `Wrangler environment "${parsed.environment}"`
    : "Wrangler base configuration";
  title(`API Client Permissions — ${target} (${parsed.remote ? "remote" : "local"})`);
  if (parsed.remote) {
    info("Remote bindings are enabled for this invocation.");
  } else {
    info("Using local bindings. Add --remote only when an operator intends to inspect or change a remote D1 database.");
  }

  const platform = await getPlatformProxy<CLIEnvironment>({
    environment: parsed.environment,
    remoteBindings: parsed.remote,
  });

  try {
    const snapshot = await inspectClientPermissions(
      platform.env.DB,
      parsed.tenantId,
      parsed.clientId,
    );

    console.log(`Tenant: ${snapshot.tenantId}`);
    console.log(`Client: ${snapshot.id} (${snapshot.name})`);
    console.log(`Status: ${snapshot.status}`);
    console.log(`Current permissions: ${snapshot.permissions.length ? snapshot.permissions.join(", ") : "(none)"}`);
    if (snapshot.permissions.includes(LEGACY_WILDCARD_PERMISSION)) {
      info("This client has the legacy '*' grant, which authorizes every scoped route. Revoke '*' explicitly before relying on least-privilege scopes.");
    }

    if (parsed.action === "inspect") return;

    const requested = new Set(parsed.scopes);
    const current = new Set(snapshot.permissions);
    const added = parsed.action === "grant"
      ? parsed.scopes.filter((scope) => !current.has(scope))
      : [];
    const removed = parsed.action === "revoke"
      ? parsed.scopes.filter((scope) => current.has(scope))
      : [];
    console.log(`Scopes to add: ${added.length ? added.join(", ") : "(none)"}`);
    console.log(`Scopes to remove: ${removed.length ? removed.join(", ") : "(none)"}`);
    if (!parsed.apply) {
      info("Dry run only. Re-run with --apply --confirm <tenant/client> to update this exact client.");
      return;
    }

    const result = await updateClientPermissions(
      platform.env.DB,
      parsed.tenantId,
      parsed.clientId,
      parsed.action,
      parsed.scopes,
    );
    console.log(`Scopes actually added: ${result.added.length ? result.added.join(", ") : "(none)"}`);
    console.log(`Scopes actually removed: ${result.removed.length ? result.removed.join(", ") : "(none)"}`);
    console.log(`Resulting permissions: ${result.client.permissions.length ? result.client.permissions.join(", ") : "(none)"}`);
    success("Client permissions updated.");
  } finally {
    await platform.dispose();
  }
}

