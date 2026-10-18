import { title, success } from "../utils/output";

import { createClient } from "../services/client-service";

import { executeStagingSql } from "../utils/wrangler";

export async function createStagingEvaluationClientCommand() {
  title("Staging Evaluation Client Creator");

  const result = await createClient({
    tenantId: "fusionlab360",
    clientId: "staging-retrieval-evaluation",
    clientName: "Staging Retrieval Evaluation",
    permissions: ["knowledge:evaluate"],
  });

  executeStagingSql(result.sql);

  success("Staging evaluation client created.");

  console.log("");
  console.log("================================");
  console.log("SAVE THIS STAGING API KEY");
  console.log("================================");
  console.log(result.apiKey);
  console.log("================================");
  console.log("");
  console.log("Store this key securely.");
  console.log("Do not share it or commit it to source control.");
}