import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import type { RequestContext } from "../../../src/context";
import type { AppBindings, AppVariables } from "../../../src/config/app";
import { ApiError } from "../../../src/core/errors/ApiError";

type LogCapture<T> = { result: T; output: string };

async function captureLogs<T>(action: () => Promise<T>): Promise<LogCapture<T>> {
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const entries: unknown[][] = [];
  const capture = (...args: unknown[]) => entries.push(args);
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;

  try {
    const result = await action();
    return { result, output: JSON.stringify(entries) };
  } finally {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
  }
}

function makeContext(): RequestContext {
  return {
    requestId: "contact-log-correlation-test",
    receivedAt: new Date("2026-10-19T00:00:00.000Z"),
    client: {} as RequestContext["client"],
    tenant: {
      id: "tenant-test",
      name: "Tenant Test",
      status: "active",
      integrations: {
        crm: {
          id: "crm-integration-test",
          provider: "gohighlevel",
          credentials: { locationId: "location-test" },
          configuration: {
            workflow: {
              key: "test-workflow",
              providerWorkflowId: "workflow-test",
              states: [],
            },
            attributeMappings: [],
          },
        },
        pms: { provider: "browser" },
      },
    } as RequestContext["tenant"],
    integrationRuntime: {
      credentials: {
        async resolve() {
          return { authType: "api_key", accessToken: "test-token" };
        },
      },
    } as RequestContext["integrationRuntime"],
  };
}

async function withDebugLogging<T>(action: () => Promise<T>): Promise<T> {
  (globalThis as typeof globalThis & { LOG_LEVEL?: string }).LOG_LEVEL = "DEBUG";
  return action();
}

test("contact create request and parsed event logs omit sensitive values", async () => {
  await withDebugLogging(async () => {
    const [{ createContactController }, { goHighLevelAdapter }] = await Promise.all([
      import("../../../src/domain/contact/controller"),
      import("../../../src/integrations/crm/gohighlevel/adapter"),
    ]);
    const previousUpsert = goHighLevelAdapter.upsertContact;
    const previousSync = goHighLevelAdapter.syncContactEvents;
    goHighLevelAdapter.upsertContact = async (_context, contact) => ({
      ...contact,
      id: "contact-test",
    });
    goHighLevelAdapter.syncContactEvents = async () => {
      throw new Error("PRIVATE_EVENT_SYNC_FAILURE");
    };

    try {
      const context = makeContext();
      const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
      app.use("*", async (c, next) => {
        c.set("context", context);
        await next();
      });
      app.post("/contacts", createContactController);

      const privateValues = [
        "PRIVATE_CONTACT_NAME",
        "private-contact@example.invalid",
        "+60123456789",
        "PRIVATE_IDENTITY_NUMBER",
        "PRIVATE_CONTACT_NOTE",
        "PRIVATE_CONTACT_EVENT",
        "PRIVATE_EVENT_SYNC_FAILURE",
      ];
      const { result: response, output } = await captureLogs(async () => await app.request(
        "/contacts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: privateValues[0],
            email: privateValues[1],
            phone: privateValues[2],
            identityNumber: privateValues[3],
            notes: `19/10/2026 - ${privateValues[5]} ${privateValues[4]}`,
          }),
        },
        {} as AppBindings,
      ));

      assert.equal(response.status, 200);
      assert.match(output, /contact\.create/);
      assert.match(output, /eventCount/);
      assert.match(output, /errorCategory/);
      for (const privateValue of privateValues) {
        assert.equal(output.includes(privateValue), false);
      }
    } finally {
      goHighLevelAdapter.upsertContact = previousUpsert;
      goHighLevelAdapter.syncContactEvents = previousSync;
    }
  });
});

test("contact update event logs omit raw event content", async () => {
  await withDebugLogging(async () => {
    const [{ updateContactService }, { goHighLevelAdapter }] = await Promise.all([
      import("../../../src/domain/contact/service"),
      import("../../../src/integrations/crm/gohighlevel/adapter"),
    ]);
    const previousUpdate = goHighLevelAdapter.updateContact;
    const previousSync = goHighLevelAdapter.syncContactEvents;
    goHighLevelAdapter.updateContact = async (_context, id, contact) => ({
      ...contact,
      id,
      firstName: "Test",
    });
    goHighLevelAdapter.syncContactEvents = async () => ({
      created: 0,
      deleted: 0,
      kept: 0,
    });

    try {
      const privateEvent = "PRIVATE_UPDATED_EVENT_CONTENT";
      const { output } = await captureLogs(() => updateContactService(
        makeContext(),
        { id: "contact-test", notes: `19/10/2026 - ${privateEvent}` },
      ));
      assert.match(output, /contact\.update/);
      assert.match(output, /eventCount/);
      assert.equal(output.includes(privateEvent), false);
      assert.equal(output.includes("CONTACT EVENTS PARSED ON UPDATE"), false);
    } finally {
      goHighLevelAdapter.updateContact = previousUpdate;
      goHighLevelAdapter.syncContactEvents = previousSync;
    }
  });
});

test("contact provider errors preserve status without exposing provider payloads", async () => {
  await withDebugLogging(async () => {
    const [{ createContactController }, { goHighLevelAdapter }, { handleError }] = await Promise.all([
      import("../../../src/domain/contact/controller"),
      import("../../../src/integrations/crm/gohighlevel/adapter"),
      import("../../../src/bootstrap/error"),
    ]);
    const previousUpsert = goHighLevelAdapter.upsertContact;
    const providerSentinel = "PRIVATE_PROVIDER_CONTACT_ERROR";
    goHighLevelAdapter.upsertContact = async () => {
      throw new ApiError(400, providerSentinel, { body: providerSentinel });
    };

    try {
      const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
      app.use("*", async (c, next) => {
        c.set("context", makeContext());
        await next();
      });
      app.onError((error) => handleError(error));
      app.post("/contacts", createContactController);
      const { result: response, output } = await captureLogs(async () => await app.request(
        "/contacts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName: "Synthetic" }),
        },
        {} as AppBindings,
      ));

      assert.equal(response.status, 400);
      const responseText = await response.text();
      assert.equal(responseText.includes(providerSentinel), false);
      assert.equal(output.includes(providerSentinel), false);
      assert.match(output, /providerStatus/);
      assert.match(output, /Contact provider operation failed/);
    } finally {
      goHighLevelAdapter.upsertContact = previousUpsert;
    }
  });
});

test("GHL metadata success and failure logs omit custom-field response data", async () => {
  await withDebugLogging(async () => {
    const { resolveMetadata } = await import("../../../src/integrations/crm/gohighlevel/metadata");
    const originalFetch = globalThis.fetch;
    const responseSentinel = "PRIVATE_CUSTOM_FIELD_RESPONSE_VALUE";
    let failContactFields = false;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("pipelines")) {
        return Response.json({ pipelines: [{ id: "pipeline-test", name: "Pipeline" }] });
      }
      if (url.includes("model=contact") && failContactFields) {
        return Response.json({ message: responseSentinel }, { status: 400 });
      }
      if (url.includes("model=contact")) {
        return Response.json({
          customFields: [{
            id: "field-test",
            name: "Identity Number",
            fieldKey: "contact.identity_number",
            value: responseSentinel,
            privateResponseProperty: responseSentinel,
          }],
        });
      }
      return Response.json({ customFields: [] });
    };

    try {
      const { output: successOutput } = await captureLogs(() =>
        resolveMetadata(makeContext(), "location-test"),
      );
      assert.match(successOutput, /Contact custom fields fetched/);
      assert.equal(successOutput.includes(responseSentinel), false);

      failContactFields = true;
      const { output: failureOutput } = await captureLogs(() =>
        resolveMetadata(makeContext(), "location-test"),
      );
      assert.match(failureOutput, /errorCategory/);
      assert.equal(failureOutput.includes(responseSentinel), false);
      assert.equal(failureOutput.includes("GHL CONTACT CUSTOM FIELDS RESPONSE"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GHL contact upsert diagnostics omit request and response payloads", async () => {
  await withDebugLogging(async () => {
    const { goHighLevelAdapter } = await import("../../../src/integrations/crm/gohighlevel/adapter");
    const originalFetch = globalThis.fetch;
    const requestSentinel = "PRIVATE_CONTACT_REQUEST_VALUE";
    const responseSentinel = "PRIVATE_CONTACT_RESPONSE_VALUE";
    let requestBody = "";
    globalThis.fetch = async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return Response.json({
        contact: {
          id: "contact-test",
          firstName: responseSentinel,
          email: "private-contact@example.invalid",
          phone: "+60123456789",
        },
      });
    };

    try {
      const { output } = await captureLogs(() => goHighLevelAdapter.upsertContact(
        makeContext(),
        {
          firstName: requestSentinel,
          email: "private-contact@example.invalid",
          phone: "+60123456789",
        },
      ));
      assert.match(requestBody, new RegExp(requestSentinel));
      assert.equal(output.includes(requestSentinel), false);
      assert.equal(output.includes(responseSentinel), false);
      assert.equal(output.includes("GHL UPSERT RESPONSE"), false);
      assert.match(output, /correlationId/);
      assert.match(output, /emailPresent/);
      assert.match(output, /phonePresent/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GHL contact event sync logs omit event values on success and failure", async () => {
  await withDebugLogging(async () => {
    const { goHighLevelAdapter } = await import("../../../src/integrations/crm/gohighlevel/adapter");
    const originalFetch = globalThis.fetch;
    const eventSentinel = "PRIVATE_CONTACT_EVENT_VALUE";
    const failureSentinel = "PRIVATE_EVENT_PROVIDER_FAILURE";
    let failRelation = false;
    const requestBodies: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.body) requestBodies.push(String(init.body));
      if (url.includes("/associations/relations/contact-test")) {
        return Response.json({ relations: [] });
      }
      if (url.endsWith("/objects/custom_event/records")) {
        return Response.json({ record: { id: "event-record-test" } });
      }
      if (url.endsWith("/associations/relations")) {
        return failRelation
          ? Response.json({ message: failureSentinel }, { status: 400 })
          : Response.json({ relation: { id: "relation-test" } });
      }
      return Response.json({});
    };

    const context = makeContext();
    context.tenant.integrations.crm.configuration!.providerConfiguration = {
      contactEvents: {
        schemaKey: "custom_event",
        primaryDisplayFieldKey: "custom_event.name",
        dateFieldKey: "custom_event.event_date",
        typeFieldKey: "custom_event.event_type",
        associationId: "association-test",
        firstObjectKey: "custom_event",
        secondObjectKey: "contact",
      },
    };

    try {
      const { output: successOutput } = await captureLogs(() =>
        goHighLevelAdapter.syncContactEvents(context, {
          contactId: "contact-test",
          events: [{ date: "2026-10-19", type: eventSentinel }],
        }),
      );
      assert.ok(requestBodies.some((body) => body.includes(eventSentinel)));
      assert.equal(successOutput.includes(eventSentinel), false);
      assert.match(successOutput, /incomingEventCount/);

      failRelation = true;
      const { output: failureOutput } = await captureLogs(async () => {
        await assert.rejects(() => goHighLevelAdapter.syncContactEvents(context, {
          contactId: "contact-test",
          events: [{ date: "2026-10-19", type: eventSentinel }],
        }));
      });
      assert.equal(failureOutput.includes(eventSentinel), false);
      assert.equal(failureOutput.includes(failureSentinel), false);
      assert.match(failureOutput, /errorCategory/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
