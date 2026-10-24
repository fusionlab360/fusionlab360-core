import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalClientCommand } from "../../../src/cli/commands/create-local-client";
import { hashApiKey } from "../../../src/core/security/api-key";
import {
  LOCAL_CORE_API_BASE_URL,
  LOCAL_CORE_DATABASE,
  LOCAL_CONSOLE_SERVICE_PERMISSIONS,
  buildLocalD1Command,
  getLocalConsoleApiDevVarsPath,
  parseLocalClientArguments,
  provisionLocalConsoleServiceClient,
  validateLocalClientInput,
} from "../../../src/cli/services/local-client-provisioner";

function validInput(
  persistTo = mkdtempSync(join(tmpdir(), "fusionlab360-local-test-")),
) {
  const consoleRoot = mkdtempSync(join(tmpdir(), "fusionlab360-console-test-"));
  mkdirSync(join(consoleRoot, "console-api"));
  const consoleApiDevVarsPath = getLocalConsoleApiDevVarsPath(consoleRoot);
  writeFileSync(consoleApiDevVarsPath, "JWT_SECRET=local-test-secret\n", "utf8");
  return {
    local: true,
    tenantId: "tenant-local",
    clientId: "console-local",
    clientName: "Local Console",
    persistTo,
    coreRoot: process.cwd(),
    wranglerPath: process.execPath,
    consoleRoot,
    consoleApiDevVarsPath,
  };
}

function mockExecutor(calls: string[]) {
  return (sql: string) => {
    calls.push(sql);
    return sql.includes("SELECT")
      ? JSON.stringify([{ results: [{ clients_present: 1, service_identity_present: 1, tenant_present: 1 }] }])
      : "";
  };
}

function cliArgs(input: ReturnType<typeof validInput>) {
  return [
    "--local", "--tenant", input.tenantId, "--client", input.clientId,
    "--name", input.clientName, "--persist-to", input.persistTo,
    "--write-console-api-dev-vars", input.consoleApiDevVarsPath,
  ];
}

test("local handoff keeps API-key and SHA-256 compatibility", async () => {
  const calls: string[] = [];
  const input = validInput();
  const result = await provisionLocalConsoleServiceClient(input, mockExecutor(calls));
  assert.match(result.apiKey, /^fl360_live_[0-9a-f]{48}$/);
  assert.match(calls[1], /INSERT INTO clients/);
  assert.match(calls[1], /INSERT INTO console_service_clients/);
  assert.equal(await hashApiKey(result.apiKey), (calls[1].match(/'([0-9a-f]{64})'/) || [])[1]);
  const vars = readFileSync(input.consoleApiDevVarsPath, "utf8");
  assert.match(vars, /JWT_SECRET=local-test-secret/);
  assert.match(vars, new RegExp(`CORE_API_BASE_URL=${LOCAL_CORE_API_BASE_URL}`));
  assert.match(vars, new RegExp(`CORE_SERVICE_TOKEN=${result.apiKey}`));
});

test("local handoff preserves the requested tenant/client association", async () => {
  const calls: string[] = [];
  await provisionLocalConsoleServiceClient(validInput(), mockExecutor(calls));
  assert.match(calls[1], /'console-local'/);
  assert.match(calls[1], /'tenant-local'/);
  assert.match(calls[1], /console_service_clients/);
});

test("minimum Console scopes are explicit and never wildcard", async () => {
  assert.deepEqual(LOCAL_CONSOLE_SERVICE_PERMISSIONS, ["tenants:provision", "tenants:read", "contacts:read", "messaging:read", "messaging:send"]);
  const calls: string[] = [];
  await provisionLocalConsoleServiceClient(validInput(), mockExecutor(calls));
  assert.match(calls[1], /tenants:provision/);
  assert.match(calls[1], /tenants:read/);
  assert.match(calls[1], /contacts:read/);
  assert.match(calls[1], /messaging:read/);
  assert.match(calls[1], /messaging:send/);
  assert.doesNotMatch(calls[1], /"\*"/);
});

test("local command arguments are explicit and reject remote targets", () => {
  const parsed = parseLocalClientArguments([
    "--local", "--tenant", "tenant-a", "--client", "client-a", "--name", "Console",
    "--persist-to", "C:\\local-state", "--write-console-api-dev-vars",
    "D:\\Important Fusion Migration\\fusionlab360-console\\console-api\\.dev.vars",
  ]);
  assert.equal(parsed.local, true);
  assert.throws(() => parseLocalClientArguments(["--remote"]), /only supports the explicit local target/);
  assert.throws(() => parseLocalClientArguments(["--env", "staging"]), /only supports the explicit local target/);
  assert.throws(() => parseLocalClientArguments([
    "--local", "--tenant", "t", "--client", "c", "--name", "n", "--persist-to", "C:\\local-state",
  ]), /--write-console-api-dev-vars is required/);
});

test("local D1 command uses the verified database, local mode and persistence path", () => {
  const args = buildLocalD1Command("C:\\temp\\query.sql", {
    database: LOCAL_CORE_DATABASE,
    persistTo: "C:\\core\\.wrangler\\state",
    cwd: "C:\\core",
    wranglerPath: "C:\\core\\node_modules\\wrangler\\bin\\wrangler.js",
  });
  assert.deepEqual(args.slice(1), [
    "d1", "execute", "fusionlab360", "--local", "--persist-to", "C:\\core\\.wrangler\\state",
    "--yes", "--json", "--file", "C:\\temp\\query.sql",
  ]);
  assert.equal(args.includes("--remote"), false);
});

test("missing persistence configuration fails before D1 execution", async () => {
  const input = validInput(join(tmpdir(), "fusionlab360-does-not-exist"));
  let executed = false;
  await assert.rejects(provisionLocalConsoleServiceClient(input, () => {
    executed = true;
    return "";
  }), /does not exist/);
  assert.equal(executed, false);
});

test("existing Console service token is never overwritten", async () => {
  const input = validInput();
  writeFileSync(input.consoleApiDevVarsPath, "JWT_SECRET=local-test-secret\nCORE_SERVICE_TOKEN=existing\n", "utf8");
  let calls = 0;
  await assert.rejects(provisionLocalConsoleServiceClient(input, () => {
    calls += 1;
    return "";
  }), /refusing to overwrite/);
  assert.equal(calls, 0);
});

test("incorrect Console or React destination is rejected before D1", async () => {
  const input = validInput();
  const wrongPath = join(input.consoleRoot, "fusionlab360-console", ".env.local");
  mkdirSync(join(input.consoleRoot, "fusionlab360-console"));
  writeFileSync(wrongPath, "", "utf8");
  input.consoleApiDevVarsPath = wrongPath;
  await assert.rejects(provisionLocalConsoleServiceClient(input, () => {
    throw new Error("must not execute");
  }), /canonical local Console API/);
});

test("missing local tenant blocks generation and insertion", async () => {
  const input = validInput();
  let calls = 0;
  await assert.rejects(provisionLocalConsoleServiceClient(input, (sql) => {
    calls += 1;
    return sql.includes("SELECT")
      ? JSON.stringify([{ results: [{ clients_present: 1, service_identity_present: 1, tenant_present: 0 }] }])
      : "";
  }), /preflight failed/);
  assert.equal(calls, 1);
  assert.doesNotMatch(readFileSync(input.consoleApiDevVarsPath, "utf8"), /CORE_SERVICE_TOKEN/);
});

test("D1 access denial is surfaced without a credential", async () => {
  await assert.rejects(provisionLocalConsoleServiceClient(validInput(), () => {
    throw new Error("GetFinalPathNameByHandleW: #5 Access is denied");
  }), /preflight failed/);
});

test("secret write failure is reported without exposing the credential", async () => {
  const calls: string[] = [];
  await assert.rejects(provisionLocalConsoleServiceClient(validInput(), mockExecutor(calls), () => {
    throw new Error("disk failure");
  }), /secret handoff failed.*not printed/);
  assert.equal(calls.length, 2);
});

test("the command does not print the generated secret", async () => {
  const secret = "fl360_live_test_secret";
  const logs: string[] = [];
  const input = validInput();
  const originalLog = console.log;
  console.log = (...values: unknown[]) => logs.push(values.join(" "));
  try {
    await createLocalClientCommand(cliArgs(input), async () => ({
      apiKey: secret,
      permissions: LOCAL_CONSOLE_SERVICE_PERMISSIONS,
      tenantId: input.tenantId,
      clientId: input.clientId,
    }));
  } finally {
    console.log = originalLog;
  }
  assert.doesNotMatch(logs.join("\n"), new RegExp(secret));
});

test("validation rejects a non-local target before execution", () => {
  const input = validInput();
  input.local = false;
  assert.throws(() => validateLocalClientInput(input), /Local target confirmation/);
});
