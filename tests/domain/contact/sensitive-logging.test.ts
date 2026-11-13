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

test("GHL contact note diagnostics omit contact, user, note identifiers, and note content", async () => {
  await withDebugLogging(async () => {
    const { goHighLevelAdapter } = await import("../../../src/integrations/crm/gohighlevel/adapter");
    const originalFetch = globalThis.fetch;
    const contactId = "PRIVATE_CONTACT_ID_SENTINEL";
    const userId = "PRIVATE_GHL_USER_ID_SENTINEL";
    const noteId = "PRIVATE_NOTE_ID_SENTINEL";
    const noteBody = "PRIVATE_CONTACT_NOTE_CONTENT_SENTINEL";
    const context = makeContext();
    context.tenant.integrations.crm.configuration!.providerConfiguration = { userId };

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/contacts/upsert")) {
        return Response.json({ contact: { id: contactId, firstName: "Synthetic" } });
      }
      if (url.includes(`/contacts/${contactId}/notes`)) {
        if (init?.method === "POST") {
          return Response.json({ note: { id: noteId } });
        }
        return Response.json({ notes: [] });
      }
      throw new Error("Unexpected synthetic GHL request.");
    };

    try {
      const { output } = await captureLogs(() => goHighLevelAdapter.upsertContact(
        context,
        { firstName: "Synthetic", email: "private@example.invalid", notes: noteBody },
      ));

      assert.match(output, /existingNotesCount/);
      for (const privateValue of [contactId, userId, noteId, noteBody, "private@example.invalid"]) {
        assert.equal(output.includes(privateValue), false, `Unexpected log value: ${privateValue}`);
      }
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

test("dated snapshots preserve multiline HTML and reject ambiguous or incomplete entries", async () => {
  const { parseContactEventSnapshot: parse } = await import("../../../src/domain/contact/event-parser");
  assert.deepEqual(parse("<p>29/09/26 - First entry<br>continued</p><p>30/09/2026 - Second &amp; final</p>"), {
    kind: "complete",
    events: [
      { date: "2026-09-29", type: "First entry\ncontinued" },
      { date: "2026-09-30", type: "Second & final" },
    ],
  });
  assert.equal(parse(undefined).kind, "omitted");
  assert.equal(parse("<p>&nbsp;</p>").kind, "blank");
  assert.equal(parse("Plain note").kind, "undated");
  for (const notes of [
    "31/02/26 - invalid",
    "29/09/26 - valid 31/02/26 - invalid",
    "29/09/26 - valid\n30/09/26",
    "29/09/26 - valid\n30/09 - missing year",
    "29/09/26 - valid\n2026-09-30 - unsupported",
    "29/09/26 - valid\n30/09/26: missing separator",
    "29/09/26 - valid\n30/09/26 - ",
    "Unstructured preface\n29/09/26 - dated",
  ]) assert.deepEqual(parse(notes), { kind: "malformed" }, notes);
});

test("contact routes share native notes and replace events only for complete snapshots", async () => {
  const { createContactController, updateContactController } = await import("../../../src/domain/contact/controller");
  const { handleError } = await import("../../../src/bootstrap/error");
  const context = makeContext();
  const configuration = {
    userId: "author-fixture",
    contactEvents: {
      schemaKey: "custom_event",
      primaryDisplayFieldKey: "custom_event.name",
      dateFieldKey: "custom_event.event_date",
      typeFieldKey: "custom_event.event_type",
      associationId: "association-fixture",
      firstObjectKey: "custom_event",
      secondObjectKey: "contact",
    },
  };
  context.tenant.integrations.crm.configuration!.providerConfiguration = configuration;
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("*", async (c, next) => { c.set("context", context); await next(); });
  app.onError(handleError);
  app.post("/contacts", createContactController);
  app.put("/contacts", updateContactController);

  const calls: string[] = [];
  const bodies: string[] = [];
  let managed = false;
  let failNoteAfterWrite = false;
  let failEvents = false;
  let incompleteRelations = false;
  let waitForList: Promise<void> | undefined;
  let listStarted: (() => void) | undefined;
  const relations = [{ firstRecordId: "old-event", secondRecordId: "contact-fixture" }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const { pathname } = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${pathname}`);
    if (init?.body) bodies.push(String(init.body));
    if (pathname === "/contacts/upsert" || pathname === "/contacts/contact-fixture") {
      return Response.json({ contact: { id: "contact-fixture" } });
    }
    if (pathname === "/contacts/contact-fixture/notes" && method === "GET") {
      listStarted?.();
      await waitForList;
      return Response.json({ notes: [
        { id: "unrelated", title: "Manual note" },
        ...(managed ? [{ id: "managed", title: "FusionLab360 Contact Notes" }] : []),
      ] });
    }
    if (pathname === "/contacts/contact-fixture/notes" && method === "POST") {
      managed = true;
      return failNoteAfterWrite
        ? Response.json({ message: "private provider detail" }, { status: 503 })
        : Response.json({ note: { id: "managed" } });
    }
    if (pathname === "/contacts/contact-fixture/notes/managed" && method === "PUT") {
      return Response.json({ note: { id: "managed" } });
    }
    if (pathname === "/associations/relations/contact-fixture") {
      if (failEvents) return Response.json({ message: "private event detail" }, { status: 503 });
      return Response.json({ relations, total: relations.length + Number(incompleteRelations) });
    }
    if (pathname === "/objects/custom_event/records/old-event" && method === "GET") {
      return Response.json({ record: { properties: { event_date: "2026-09-28", event_type: "Old entry" } } });
    }
    if (pathname === "/objects/custom_event/records/old-event" && method === "DELETE") {
      relations.length = 0;
      return Response.json({ success: true });
    }
    if (pathname === "/objects/custom_event/records" && method === "POST") {
      return Response.json({ record: { id: "new-event" } });
    }
    if (pathname === "/associations/relations" && method === "POST") return Response.json({});
    assert.fail(`Unexpected mock operation: ${method} ${pathname}`);
  };
  const request = async (method: "POST" | "PUT", notes?: string) => app.request("/contacts", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(method === "PUT" ? { id: "contact-fixture" } : { email: "synthetic@example.invalid" }),
      firstName: "Synthetic",
      notes,
    }),
  });
  try {
    for (const notes of [undefined, "    ", "<p>&nbsp;</p>", "Plain note", "29/09/26 - valid 31/02/26 - invalid"]) {
      assert.equal((await request("PUT", notes)).status, 200);
      assert.equal(relations.length, 1);
    }
    assert.ok(calls.every((call) => !call.includes("/associations") && !call.includes("/objects")));
    assert.equal(calls.filter((call) => call === "POST /contacts/contact-fixture/notes").length, 1);
    assert.equal(calls.filter((call) => call === "PUT /contacts/contact-fixture/notes/managed").length, 1);
    assert.ok(!calls.some((call) => call.includes("/unrelated")));

    const raw = "  <p>29/09/26 - New entry<br>continuation</p><p>29/09/2026 - New entry<br>continuation</p>  ";
    incompleteRelations = true;
    assert.equal((await request("PUT", raw)).status, 200);
    assert.equal(relations.length, 1);
    incompleteRelations = false;
    assert.equal((await request("POST", raw)).status, 200);
    assert.equal(relations.length, 0);
    assert.ok(bodies.some((body) => JSON.parse(body).body === raw));
    assert.equal(calls.filter((call) => call === "POST /objects/custom_event/records").length, 1);

    configuration.userId = "";
    const before = calls.length;
    const { result: missingAuthor, output: missingAuthorLog } = await captureLogs(() => request("PUT", "Private fixture text"));
    assert.equal(missingAuthor.status, 500);
    assert.deepEqual(calls.slice(before), ["PUT /contacts/contact-fixture"]);
    assert.match(missingAuthorLog, /validate_author/);
    assert.match(missingAuthorLog, /partial_success/);
    assert.doesNotMatch(missingAuthorLog, /Private fixture text/);
    configuration.userId = "author-fixture";

    managed = false;
    failNoteAfterWrite = true;
    const { result: failedNote, output: noteLog } = await captureLogs(() => request("PUT", "Retry fixture"));
    assert.equal(failedNote.status, 503);
    assert.match(noteLog, /partial_success/);
    assert.doesNotMatch(noteLog, /private provider detail/);
    assert.equal((await request("PUT", "Retry fixture")).status, 200);
    assert.equal(calls.filter((call) => call === "POST /contacts/contact-fixture/notes").length, 2);

    failEvents = true;
    const { result: failedEvent, output: eventLog } = await captureLogs(() => request("PUT", raw));
    assert.equal(failedEvent.status, 200);
    assert.match(eventLog, /partial_success/);
    assert.doesNotMatch(eventLog, /private event detail/);
    assert.ok(!calls.some((call) => call.includes("/unrelated")));

    let release!: () => void;
    waitForList = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { listStarted = resolve; });
    const first = request("PUT", "Concurrent fixture");
    try {
      await started;
      assert.equal((await request("PUT", "Concurrent fixture")).status, 409);
    } finally {
      release();
      await first;
    }
    assert.equal((await first).status, 200);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("contact route honors tenant credentials and stops before GHL for a disabled integration", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { hashApiKey } = await import("../../../src/core/security/api-key");
  const { createApplication } = await import("../../../src/bootstrap/routes");
  const database = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  try {
    for (const tenant of ["a", "b"]) {
      database.prepare("INSERT INTO tenants(id,name,status) VALUES (?,?,'active')").run(tenant, tenant);
      database.prepare("INSERT INTO integrations(id,tenant_id,provider,enabled) VALUES (?,?,'gohighlevel',?)")
        .run(`ghl-${tenant}`, tenant, Number(tenant === "a"));
      database.prepare("INSERT INTO integration_credentials(tenant_id,provider,auth_type,api_key,location_id) VALUES (?,'gohighlevel','api_key',?,?)")
        .run(tenant, `synthetic-provider-${tenant}`, `location-${tenant}`);
      database.prepare("INSERT INTO clients(id,tenant_id,name,api_key_hash,status,permissions) VALUES (?,?,?,?,'active',?)")
        .run(`client-${tenant}`, tenant, tenant, await hashApiKey(`fl360_contact_fixture_${tenant}`), '["contacts:update"]');
    }
    const DB = {
      prepare(sql: string) {
        return {
          bind(...values: import("node:sqlite").SQLInputValue[]) {
            const statement = database.prepare(sql);
            return {
              first: async () => statement.get(...values) ?? null,
              all: async () => ({ results: statement.all(...values) }),
            };
          },
        };
      },
    } as unknown as AppBindings["DB"];
    const app = createApplication("production");
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = async (input, init) => {
      providerCalls++;
      assert.equal(new URL(String(input)).pathname, "/contacts/foreign-contact");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-provider-a");
      return Response.json({ message: "Synthetic foreign contact missing" }, { status: 404 });
    };
    const request = (tenant: string) => app.request("/contacts", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer fl360_contact_fixture_${tenant}` },
      body: JSON.stringify({ id: "foreign-contact", tenantId: "b", notes: "Fixture note" }),
    }, {
      DB, APP_ENVIRONMENT: "production", CORE_CREDENTIAL_LEGACY_READS_ENABLED: "true",
      JWT_SECRET: "synthetic-contact-secret", JWT_ISSUER: "fixture", JWT_AUDIENCE: "fixture",
    } as AppBindings);
    try {
      const response = await request("a");
      assert.equal(response.status, 404, await response.text());
      assert.equal(providerCalls, 1);
      assert.equal((await request("b")).status, 500);
      assert.equal(providerCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    database.close();
  }
});
