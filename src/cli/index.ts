import { createClientCommand } from "./commands/create-client";
import { createTenantCommand } from "./commands/create-tenant";
import { clientPermissionsCommand } from "./commands/client-permissions";
import { integrationEventReplayCommand } from "./commands/integration-event-replay";

import {
  createStagingEvaluationClientCommand,
} from "./commands/create-staging-evaluation-client";
import { createLocalClientCommand } from "./commands/create-local-client";

// Future commands
// import { createTenantCommand } from "./commands/create-tenant";
// import { listClientsCommand } from "./commands/list-clients";
// import { rotateClientCommand } from "./commands/rotate-key";
// import { revokeClientCommand } from "./commands/revoke-key";

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "client:create":
      await createClientCommand();
      break;

    case "client:create-local":
      await createLocalClientCommand();
      break;

    case "client:permissions":
      await clientPermissionsCommand();
      break;

    case "integration-event:replay":
      await integrationEventReplayCommand();
      break;

    case "client:list":
      console.log("Coming soon...");
      break;

    case "client:rotate":
      console.log("Coming soon...");
      break;

    case "client:revoke":
      console.log("Coming soon...");
      break;
      
    case "tenant:create":
      await createTenantCommand();
      break;

    case "client:create-staging-evaluation":
      await createStagingEvaluationClientCommand();
      break;

    // Future
    // case "tenant:create":
    //   await createTenantCommand();
    //   break;

    default:
      console.log(`
FusionLab360 CLI

Available commands

  client:create
  client:create-local --local --tenant <id> --client <id> --name <name> --persist-to <path> --write-console-api-dev-vars <path>
  client:permissions <inspect|grant|revoke>
  integration-event:replay <inspect|replay>
  client:list
  client:rotate
  client:revoke

Future

  tenant:create
`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
