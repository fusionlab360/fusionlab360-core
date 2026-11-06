import assert from "node:assert/strict";
import test from "node:test";

import { createApp, type AppBindings } from "../../src/config/app";

test("request logging omits customer identifiers and query values", async () => {
  const app = createApp();
  app.get("/contacts/:contactId", (c) => c.text("ok"));

  const entries: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => entries.push(args);

  try {
    const response = await app.request(
      "/contacts/contact-private-123?email=private@example.test",
      {},
      {
        JWT_SECRET: "synthetic-jwt-secret",
        JWT_ISSUER: "synthetic-issuer",
        JWT_AUDIENCE: "synthetic-audience",
      } as AppBindings,
    );

    assert.equal(response.status, 200);
    assert.match(JSON.stringify(entries), /HTTP request received/);
    assert.match(JSON.stringify(entries), /GET/);
    assert.equal(JSON.stringify(entries).includes("contact-private-123"), false);
    assert.equal(JSON.stringify(entries).includes("private@example.test"), false);
  } finally {
    console.log = originalLog;
  }
});
