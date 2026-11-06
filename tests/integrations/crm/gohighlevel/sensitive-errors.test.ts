import assert from "node:assert/strict";
import test from "node:test";

import type { RequestContext } from "../../../../src/context";
import type { IntegrationRuntime } from "../../../../src/core/integration/runtime";
import { ApiError } from "../../../../src/core/errors/ApiError";
import { handleError } from "../../../../src/bootstrap/error";
import { ghlFetchAuthenticated } from "../../../../src/integrations/crm/gohighlevel/client";

function makeContext(runtime: IntegrationRuntime): RequestContext {
  return {
    requestId: "synthetic-ghl-error-request",
    receivedAt: new Date("2026-11-01T00:00:00.000Z"),
    client: {
      id: "synthetic-client",
      name: "Synthetic Client",
      tenantId: "synthetic-tenant",
      apiKey: "synthetic-api-key",
      status: "active",
      permissions: [],
    },
    tenant: {
      id: "synthetic-tenant",
      name: "Synthetic Tenant",
      status: "active",
      integrations: {
        crm: {
          id: "synthetic-crm-integration",
          provider: "gohighlevel",
          credentials: { locationId: "synthetic-location" },
        },
        pms: { provider: "browser" },
      },
    } as RequestContext["tenant"],
    integrationRuntime: runtime,
  };
}

test("GHL OAuth failure paths redact endpoint identifiers and provider error payloads", async () => {
  const endpoint = "/contacts/PRIVATE_CONTACT_ID_SENTINEL/notes?email=private@example.invalid";
  const providerError = "PRIVATE_PROVIDER_ERROR_SENTINEL";
  let fetchCalls = 0;
  const runtime: IntegrationRuntime = {
    credentials: {
      async resolve(request) {
        return {
          authType: "oauth2",
          accessToken: request.forceRefresh ? "synthetic-refreshed-token" : "synthetic-expired-token",
        };
      },
    },
  };
  const originalFetch = globalThis.fetch;
  const originalLogs = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const captured: unknown[][] = [];
  const capture = (...args: unknown[]) => captured.push(args);
  console.debug = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ message: providerError }, { status: fetchCalls === 1 ? 401 : 400 });
  };

  try {
    let thrown: unknown;
    await assert.rejects(
      ghlFetchAuthenticated(makeContext(runtime), endpoint),
      (error: unknown) => {
        thrown = error;
        return error instanceof ApiError && error.status === 400 && error.details === undefined;
      },
    );

    assert.equal(fetchCalls, 2);
    const response = handleError(thrown);
    const responseText = await response.text();
    const logText = JSON.stringify(captured);
    for (const privateValue of ["PRIVATE_CONTACT_ID_SENTINEL", "private@example.invalid", providerError]) {
      assert.equal(responseText.includes(privateValue), false);
      assert.equal(logText.includes(privateValue), false);
    }
    assert.match(responseText, /GoHighLevel API request failed \(400\)\./);
  } finally {
    globalThis.fetch = originalFetch;
    console.debug = originalLogs.debug;
    console.info = originalLogs.info;
    console.warn = originalLogs.warn;
    console.error = originalLogs.error;
  }
});
