import { createClientCommand } from "./commands/create-client";
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

    default:
      console.log(`
FusionLab360 CLI

Available commands

  client:create
  client:list
  client:rotate
  client:revoke
`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});