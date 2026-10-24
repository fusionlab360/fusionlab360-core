import { closePrompt } from "../utils/prompt";
import {
  parseLocalClientArguments,
  provisionLocalConsoleServiceClient,
} from "../services/local-client-provisioner";
import type {
  LocalClientProvisioningResult,
} from "../services/local-client-provisioner";

type LocalProvisioner = (
  input: ReturnType<typeof parseLocalClientArguments>,
) => Promise<LocalClientProvisioningResult>;

export async function createLocalClientCommand(
  args = process.argv.slice(3),
  provision: LocalProvisioner = provisionLocalConsoleServiceClient,
): Promise<void> {
  try {
    const result = await provision(parseLocalClientArguments(args));

    console.log(
      `Local Console service client ${result.clientId} was created for tenant ${result.tenantId}.`,
    );
    console.log(`Granted scopes: ${result.permissions.join(", ")}.`);
    console.log("The API key was generated but is intentionally not printed.");
    console.log("Store it only in the server-side local Console API secret configuration.");
  } finally {
    await closePrompt();
  }
}
