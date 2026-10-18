import { prompt, closePrompt } from "../utils/prompt";
import { title, success } from "../utils/output";

import {
  parsePermissionScopes,
} from "../../clients/permissions";

import {
  createClient,
} from "../services/client-service";

import {
  executeSqlForSelectedEnvironment,
} from "../utils/execute-targeted-sql";

export async function createClientCommand(): Promise<void> {
  title("FusionLab360 Client Creator");

  try {
    const tenantId = await prompt("Tenant ID: ");
    const clientId = await prompt("Client ID: ");
    const clientName = await prompt("Client Name: ");
    const permissionsInput = await prompt(
      "Permission scopes (comma-separated): ",
    );

    const permissions = parsePermissionScopes(
      permissionsInput
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    );

    if (!tenantId || !clientId || !clientName) {
      throw new Error(
        "Tenant ID, Client ID, and Client Name are required.",
      );
    }
    const result = await createClient({
      tenantId,
      clientId,
      clientName,
      permissions,
    });

    const target = await executeSqlForSelectedEnvironment(
      result.sql,
      `CREATE CLIENT ${clientId}`,
    );

    success(`Client created in ${target}.`);
    console.log(
      "Save the new API key securely. Do not share it in logs or chat:",
    );
    console.log(result.apiKey);
  } finally {
    await closePrompt();
  }
}