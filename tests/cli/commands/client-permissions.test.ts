import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { parseClientPermissionArguments } from "../../../src/cli/commands/client-permissions";

const base = ["grant", "--tenant", "tenant-a", "--client", "client-a"];

test("permission inspect requires explicit tenant and client and stays local by default", () => {
  const parsed = parseClientPermissionArguments([
    "inspect", "--tenant", "tenant-a", "--client", "client-a",
  ]);
  assert.equal(parsed.remote, false);
  assert.equal(parsed.apply, false);
  assert.equal(parsed.action, "inspect");
});

test("permission mutation defaults to dry run and accepts explicit scopes", () => {
  const parsed = parseClientPermissionArguments([
    ...base, "--scope", "contacts:read", "--scope", "ai:read", "--env", "staging",
  ]);
  assert.deepEqual(parsed.scopes, ["contacts:read", "ai:read"]);
  assert.equal(parsed.environment, "staging");
  assert.equal(parsed.apply, false);
  assert.equal(parsed.remote, false);
});

test("remote mutation requires explicit target confirmation", () => {
  assert.throws(
    () => parseClientPermissionArguments([
      ...base, "--scope", "ai:read", "--remote", "--apply",
    ]),
    /Mutation requires --confirm/,
  );
  const parsed = parseClientPermissionArguments([
    ...base,
    "--scope", "ai:read",
    "--remote",
    "--apply",
    "--confirm", "tenant-a/client-a",
  ]);
  assert.equal(parsed.remote, true);
  assert.equal(parsed.apply, true);
});

test("permission command rejects wrong confirmations, unknown scopes, and wildcard grants", () => {
  assert.throws(
    () => parseClientPermissionArguments([
      ...base, "--scope", "ai:read", "--apply", "--confirm", "tenant-b/client-a",
    ]),
    /Mutation requires --confirm/,
  );
  assert.throws(
    () => parseClientPermissionArguments([...base, "--scope", "custom:all"]),
    /Unsupported permission scope/,
  );
  assert.throws(
    () => parseClientPermissionArguments([...base, "--scope", "*"]),
    /Unsupported permission scope/,
  );
});

test("remote permission inspection uses explicit remote D1 bindings without changing local dev behavior", () => {
  const configPath = resolve(process.cwd(), "wrangler.jsonc");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    d1_databases: Array<{ binding: string; remote?: boolean }>;
    env: Record<string, {
      d1_databases?: Array<{ binding: string; remote?: boolean }>;
    }>;
  };

  assert.equal(
    config.d1_databases.find(({ binding }) => binding === "DB")?.remote,
    true,
    "base Wrangler binding supports the CLI's explicit --remote mode",
  );
  assert.equal(
    config.env.dev.d1_databases?.find(({ binding }) => binding === "DB")?.remote,
    false,
    "the npm dev profile continues to use local D1 simulation",
  );
  assert.equal(
    config.env.staging.d1_databases?.find(({ binding }) => binding === "DB")?.remote,
    true,
    "the selected staging environment can use its configured remote D1",
  );
});
