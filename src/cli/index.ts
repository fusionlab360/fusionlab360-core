import { createClientCommand } from "./commands/create-client";
import { createTenantCommand } from "./commands/create-tenant";

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

    // Future
    // case "tenant:create":
    //   await createTenantCommand();
    //   break;

    default:
      console.log(`
FusionLab360 CLI

Available commands

  client:create
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