import { getPlatformProxy } from "wrangler";
import { inspectServiceClient, provisionServiceClient } from "../services/service-client-provisioner";
import { info, success, title } from "../utils/output";

interface CLIEnvironment {
  DB: D1Database;
}

export interface ParsedServiceClientArguments {
  action: "provision" | "inspect";
  tenantId: string;
  clientId: string;
  clientName?: string;
  operatorIdentity?: string;
  target: "production";
  remote: true;
  confirmation?: string;
}

export function parseServiceClientArguments(args: readonly string[]): ParsedServiceClientArguments {
  const action = args[0];
  if (action !== "provision" && action !== "inspect") {
    throw new Error("Usage: client:service <provision|inspect> --tenant gmmetro --client <id> --target production --remote [--name <name> --operator <id> --confirm <value>]");
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--remote") {
      if (flags.has(argument)) throw new Error("Duplicate argument: --remote");
      flags.add(argument);
      continue;
    }
    if (!["--tenant", "--client", "--name", "--operator", "--target", "--confirm"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--") || values.has(argument)) {
      throw new Error(`A single value is required for ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }
  const tenantId = values.get("--tenant");
  const clientId = values.get("--client");
  const target = values.get("--target");
  if (!tenantId || !clientId || target !== "production" || !flags.has("--remote")) {
    throw new Error("Production service-client operations require --tenant, --client, --target production, and --remote.");
  }
  if (tenantId !== "gmmetro") {
    throw new Error("This provisioning command is restricted to the approved gmmetro tenant.");
  }
  const parsed: ParsedServiceClientArguments = {
    action,
    tenantId,
    clientId,
    target: "production",
    remote: true,
    clientName: values.get("--name"),
    operatorIdentity: values.get("--operator"),
    confirmation: values.get("--confirm"),
  };
  if (action === "inspect") {
    if (parsed.clientName || parsed.operatorIdentity || parsed.confirmation) {
      throw new Error("Inspection does not accept provisioning options.");
    }
  } else if (!parsed.clientName || !parsed.operatorIdentity || parsed.confirmation !== `PRODUCTION_SERVICE_CLIENT/${tenantId}/${clientId}/${parsed.operatorIdentity}`) {
    throw new Error("Provisioning requires --name, --operator, and the exact production confirmation string.");
  }
  return parsed;
}

export async function serviceClientCommand(
  args: readonly string[] = process.argv.slice(3),
): Promise<void> {
  const parsed = parseServiceClientArguments(args);
  title(`Headless Core Service Client — ${parsed.action}`);
  info("Target: production remote D1. No Console UI or application deployment is involved.");
  const platform = await getPlatformProxy<CLIEnvironment>({ remoteBindings: true });
  try {
    if (parsed.action === "inspect") {
      const result = await inspectServiceClient(platform.env.DB, parsed.tenantId, parsed.clientId);
      if (!result) {
        throw new Error("The requested service client was not found.");
      }
      console.log(`Tenant: ${result.tenantId}`);
      console.log(`Client: ${result.clientId}`);
      console.log(`Status: ${result.status}`);
      console.log(`Permissions: ${result.permissions.join(", ") || "(none)"}`);
      console.log(`Service marker: ${result.serviceMarker ? "present" : "absent"}`);
      console.log(`contacts:read tenant grant: ${result.contactsReadGrant ? "present" : "absent"}`);
      return;
    }

    const result = await provisionServiceClient(platform.env.DB, {
      tenantId: parsed.tenantId,
      clientId: parsed.clientId,
      clientName: parsed.clientName!,
      operatorIdentity: parsed.operatorIdentity!,
    });
    success("Service client provisioned atomically.");
    console.log("The generated API key is shown once below. Store it in an operator-controlled secret store; do not redirect, log, commit, or paste it into reports.");
    console.log(result.apiKey);
  } finally {
    await platform.dispose();
  }
}
