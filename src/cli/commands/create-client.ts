import { prompt, closePrompt } from "../utils/prompt";
import { title, success } from "../utils/output";

import { createClient } from "../services/client-service";

import { executeSql } from "../utils/wrangler";


export async function createClientCommand() {
  title("FusionLab360 Client Creator");

  const tenantId = await prompt("Tenant ID: ");
  const clientId = await prompt("Client ID: ");
  const clientName = await prompt("Client Name: ");

  const result = await createClient({
  tenantId,
  clientId,
  clientName,
});
  
  executeSql(result.sql);

  success("Client created.");
  
  console.log("");
  console.log("================================");
  console.log("SAVE THIS API KEY");
  console.log("================================");
  console.log(result.apiKey);
  console.log("================================");

  await closePrompt();
}