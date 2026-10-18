import { prompt, closePrompt } from "../utils/prompt";
import { title, success } from "../utils/output";
import { CLI_CONFIG } from "../config";

import {
  parsePermissionScopes,
} from "../../clients/permissions";

import {
  createTenant,
} from "../services/tenant-service";

import {
  executeSqlForSelectedEnvironment,
} from "../utils/execute-targeted-sql";

export async function createTenantCommand(): Promise<void> {
  title("FusionLab360 Tenant Creator — OAuth-first");

  try {
    const tenantId = await prompt("Tenant ID: ");
    const tenantName = await prompt("Tenant Name: ");
    const companyId = await prompt("GoHighLevel Company ID: ");
    const locationId = await prompt("GoHighLevel Location ID: ");

    const permissionsInput = await prompt(
      "FusionLab360 client permission scopes (comma-separated): ",
    );

    if (
      !tenantId ||
      !tenantName ||
      !companyId ||
      !locationId
    ) {
      throw new Error(
        "Tenant ID, name, Company ID, and Location ID are required.",
      );
    }

    const permissions = parsePermissionScopes(
      permissionsInput
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    );

    const result = await createTenant({
      tenantId,
      tenantName,
      provider: CLI_CONFIG.defaultProvider,
      companyId,
      locationId,
      permissions,
    });

    const target = await executeSqlForSelectedEnvironment(
      result.sql,
      `CREATE TENANT ${tenantId}`,
    );

    success(`Pending OAuth tenant created in ${target}.`);
    console.log(
      "The tenant and GHL integration remain inactive until OAuth credential sync is completed.",
    );
    console.log(
      "No PIT was collected or stored. Use this client key only with POST /oauth/gohighlevel/authorize; ordinary tenant APIs remain unavailable until OAuth completes.",
    );
    console.log(
      "Save the new FusionLab360 client API key securely. Do not paste it into chat:",
    );
    console.log(result.apiKey);
  } finally {
    await closePrompt();
  }
}
