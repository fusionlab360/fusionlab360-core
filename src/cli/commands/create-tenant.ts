import { prompt, closePrompt } from "../utils/prompt";
import { title, success } from "../utils/output";
import { executeSql } from "../utils/wrangler";
import { CLI_CONFIG } from "../config";

import {
  createTenant,
} from "../services/tenant-service";

export async function createTenantCommand() {

  title("FusionLab360 Tenant Creator");

  const tenantId = await prompt("Tenant ID: ");
  const tenantName = await prompt("Tenant Name: ");

  const provider = CLI_CONFIG.defaultProvider;

  const apiKey = await prompt("PIT API Key: ");
  const locationId = await prompt("Location ID: ");

  const result = await createTenant({
    tenantId,
    tenantName,
    provider,
    apiKey,
    locationId,
  });

  executeSql(result.sql);

  success("Tenant created.");

  console.log("");
  console.log("================================");
  console.log("SAVE THIS API KEY");
  console.log("================================");
  console.log(result.apiKey);
  console.log("================================");

  await closePrompt();
}