import {
  executeSql,
  executeStagingSql,
} from "./wrangler";

import {
  confirmProvisioningEnvironment,
} from "./target-environment";

export async function executeSqlForSelectedEnvironment(
  sql: string,
  operationDescription: string,
): Promise<"staging" | "production"> {
  const target = await confirmProvisioningEnvironment(
    operationDescription,
  );

  if (target === "staging") {
    executeStagingSql(sql);
  } else {
    executeSql(sql);
  }

  return target;
}