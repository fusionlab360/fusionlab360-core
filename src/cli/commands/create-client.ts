import { prompt, closePrompt } from "../utils/prompt";
import { title, success } from "../utils/output";
import { executeSql } from "../utils/wrangler";

import { generateApiKey } from "../../clients/generator";
import { hashApiKey } from "../../core/security/api-key";
import { buildInsertClientSql } from "../sql/insert-client";

export async function createClientCommand() {
  title("FusionLab360 Client Creator");

  const tenantId = await prompt("Tenant ID: ");
  const clientId = await prompt("Client ID: ");
  const clientName = await prompt("Client Name: ");

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  const sql = buildInsertClientSql({
    tenantId,
    clientId,
    clientName,
    apiKeyHash,
  });

  executeSql(sql);

  success("Client created.");

  console.log("");
  console.log("================================");
  console.log("SAVE THIS API KEY");
  console.log("================================");
  console.log(apiKey);
  console.log("================================");

  await closePrompt();
}