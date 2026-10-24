import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

import type { AIProvider } from "../../../src/core/ai";
import type { IntegrationContext } from "../../../src/context/integration";
import type { MessagingMessage } from "../../../src/core/messaging";

import {
  setTenantFeatureEnabled,
} from "../../../src/domain/features/tenant-feature-service";

import {
  classifyBookingReadback,
  processAIBooking,
  type ProcessAIBookingInput,
} from "../../../src/domain/booking/ai-booking-service";
import type { BookingResult } from "../../../src/core/booking";
import { AIBookingSessionRepository } from "../../../src/persistence/repositories/ai-booking-session-repository";

import type {
  BookingIntent,
} from "../../../src/domain/booking/booking-intent";
import { appointmentLocalTimeToISO, parseAppointmentPreference } from "../../../src/domain/booking/appointment-preference";

/**
 * Minimal SQLite-backed D1 test double.
 *
 * It creates only the tables required by the AI booking
 * session repository and tenant feature settings service.
 */
class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");

 constructor() {
  this.sqlite.exec(`
    CREATE TABLE ai_booking_sessions (
      tenant_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      booking_type TEXT NOT NULL,
      offering_id TEXT,
      resource_id TEXT,
      start_at TEXT,
      end_at TEXT,
      adults INTEGER,
      children INTEGER,
      quantity INTEGER,
      pending_slots_json TEXT,
      data_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (
        tenant_id,
        provider,
        conversation_id
      )
    );

    CREATE TABLE tenant_feature_settings (
      tenant_id TEXT NOT NULL,
      feature_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
        CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, feature_key)
    );

    CREATE TABLE integrations (
      id TEXT PRIMARY KEY NOT NULL,
      settings TEXT NOT NULL DEFAULT '{}'
    );
  `);
}



  prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];

    const statement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },

      run: async () => {
        const result = this.sqlite
          .prepare(sql)
          .run(...(bindings as never[]));

        return {
          meta: {
            changes: Number(result.changes),
          },
        };
      },

      first: async <T>() => {
        const result = this.sqlite
          .prepare(sql)
          .get(...(bindings as never[]));

        return (result as T | undefined) ?? null;
      },

      all: async <T>() => ({
        results: this.sqlite
          .prepare(sql)
          .all(...(bindings as never[])) as T[],
      }),
    };

    return statement as unknown as D1PreparedStatement;
  }

  close(): void {
    this.sqlite.close();
  }
}

type TestBookingType = "appointment" | "accommodation";

function createIntent(
  bookingType: TestBookingType,
  action: "start" | "cancel" = "start",
): BookingIntent {
  const isAppointment = bookingType === "appointment";

  return {
    action,
    bookingType,
    offeringQuery: isAppointment
      ? "consultation"
      : "standard room",
    branchQuery: null,
    resourceQuery: null,
    date: "2026-10-20",
    time: isAppointment ? "10:00" : null,
    start: isAppointment
      ? "2026-10-20T10:00:00+08:00"
      : "2026-10-20",
    end: isAppointment
      ? "2026-10-20T10:30:00+08:00"
      : "2026-10-21",
    adults: isAppointment ? null : 2,
    children: null,
    quantity: isAppointment ? null : 1,
    slotNumber: null,
    confidence: 0.99,
    reason: "Deterministic AI booking test intent.",
  };
}

function createInput(
  db: SqliteD1Database,
  bookingType: TestBookingType,
  action: "start" | "cancel" = "start",
  crmProvider?: "gohighlevel",
): ProcessAIBookingInput {
  const tenantId = "ai-booking-feature-test-tenant";
  const intent = createIntent(bookingType, action);

  const ai: AIProvider = {
    async chat() {
      return {
        text: JSON.stringify(intent),
        provider: "test-provider",
        model: "test-model",
      };
    },
  };

  const context = {
  tenant: {
    id: tenantId,
    ...(crmProvider === "gohighlevel"
      ? {
          integrations: {
            crm: {
              id: "ai-booking-feature-test-integration",
              provider: "gohighlevel",
            },
          },
        }
      : {}),
  },
    // Deliberately unregistered. If provider resolution happens
    // before the disabled-feature guard, the test will fail.
    provider: "unregistered-test-provider",
    requestId: "ai-booking-feature-test",
    receivedAt: new Date("2026-10-17T00:00:00.000Z"),
    integrationRuntime: {},
  } as unknown as IntegrationContext;

  return {
    db: db as unknown as D1Database,
    context,
    ai,
    history: [],
    currentMessage:
      action === "cancel"
        ? "Cancel this booking process."
        : bookingType === "appointment"
          ? "Book a clinic appointment."
          : "Book a hotel room.",
    occurredAt: "2026-10-17T00:00:00.000Z",
    conversationId: `conversation-${bookingType}-${action}`,
    customerId: "test-customer",
  };
}

function createReadback(
  status: BookingResult["status"],
  overrides: Partial<BookingResult> = {},
): BookingResult {
  return {
    bookingId: "provider-appointment-1",
    status,
    type: "appointment",
    offeringId: "calendar-1",
    customerId: "customer-1",
    start: "2026-10-20T02:00:00.000Z",
    end: "2026-10-20T02:30:00.000Z",
    ...overrides,
  };
}

test("booking readback confirms only an exact confirmed appointment", () => {
  const expected = {
    bookingId: "provider-appointment-1",
    offeringId: "calendar-1",
    customerId: "customer-1",
    start: "2026-10-20T02:00:00.000Z",
    end: "2026-10-20T02:30:00.000Z",
  };

  assert.equal(
    classifyBookingReadback(expected, createReadback("confirmed")),
    "confirmed",
  );
  assert.equal(
    classifyBookingReadback(expected, createReadback("pending")),
    "pending",
  );
  assert.equal(
    classifyBookingReadback(expected, createReadback("cancelled")),
    "failed",
  );
  assert.equal(
    classifyBookingReadback(
      expected,
      createReadback("confirmed", { customerId: "different-customer" }),
    ),
    "failed",
  );
  assert.equal(
    classifyBookingReadback(
      expected,
      createReadback("confirmed", { bookingId: "different-appointment" }),
    ),
    "failed",
  );
  assert.equal(
    classifyBookingReadback(
      expected,
      createReadback("confirmed", { offeringId: "different-calendar" }),
    ),
    "failed",
  );
  assert.equal(
    classifyBookingReadback(
      expected,
      createReadback("confirmed", {
        start: "2026-10-20T10:00:00+08:00",
        end: "2026-10-20T10:30:00+08:00",
      }),
    ),
    "confirmed",
  );
  assert.equal(
    classifyBookingReadback(
      expected,
      createReadback("confirmed", { start: "2026-10-20T03:00:00Z" }),
    ),
    "failed",
  );
  assert.equal(
    classifyBookingReadback(
      expected,
      createReadback("confirmed", { start: "2026-10-20T02:00:00" }),
    ),
    "failed",
  );
  assert.equal(
    classifyBookingReadback(
      expected,
      createReadback("confirmed", { start: "not-a-timestamp" }),
    ),
    "failed",
  );
});

test("unresolved booking creation state blocks a duplicate create attempt", async () => {
  const db = new SqliteD1Database();
  const tenantId = "ai-booking-feature-test-tenant";
  const provider = "unregistered-test-provider";

  try {
    for (const [index, status] of [
      "in_progress",
      "pending",
      "uncertain",
      "failed",
    ].entries()) {
      const conversationId = `unresolved-booking-${index}`;
      db.sqlite.prepare(`
        INSERT INTO ai_booking_sessions (
          tenant_id, provider, conversation_id, status, booking_type,
          offering_id, start_at, end_at, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'awaiting_confirmation', 'appointment', ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        provider,
        conversationId,
        "calendar-1",
        "2026-10-20T02:00:00.000Z",
        "2026-10-20T02:30:00.000Z",
        JSON.stringify({
          bookingCreationStatus: status,
          bookingId: "provider-appointment-1",
        }),
        "2026-10-17T00:00:00.000Z",
        "2026-10-17T00:00:00.000Z",
      );

      const input = createInput(db, "appointment");
      input.conversationId = conversationId;
      const first = await processAIBooking(input);
      const second = await processAIBooking(input);

      assert.equal(first.state, "awaiting_confirmation");
      assert.equal(second.state, "awaiting_confirmation");
      assert.equal(first.actionResult, "uncertain");
      assert.match(first.message, /before another booking is attempted/i);
      assert.match(first.message, /provider-appointment-1/);
    }
  } finally {
    db.close();
  }
});

test("booking creation attempt fence requires the exact execution claim", async () => {
  const db = new SqliteD1Database();
  const repository = new AIBookingSessionRepository(db as unknown as D1Database);
  const now = "2026-10-17T00:00:00.000Z";

  try {
    db.sqlite.prepare(`
      INSERT INTO ai_booking_sessions (
        tenant_id, provider, conversation_id, status, booking_type, created_at, updated_at
      ) VALUES ('tenant-a', 'provider-a', 'conversation-a', 'awaiting_confirmation', 'appointment', ?, ?)
    `).run(now, now);

    assert.equal(
      await repository.markBookingCreationAttempt(
        "tenant-a", "provider-a", "conversation-a", "wrong-claim", now,
      ),
      false,
    );
    assert.equal(
      await repository.claimBookingExecution(
        "tenant-a", "provider-a", "conversation-a", "valid-claim",
      ),
      true,
    );
    assert.equal(
      await repository.markBookingCreationAttempt(
        "tenant-a", "provider-a", "conversation-a", "valid-claim", now,
      ),
      true,
    );
    assert.equal(
      await repository.markBookingCreationAttempt(
        "tenant-a", "provider-a", "conversation-a", "other-claim", now,
      ),
      false,
    );
  } finally {
    db.close();
  }
});

test("recording an identity blocker cannot overwrite an active booking execution claim", async () => {
  const db = new SqliteD1Database();
  const repository = new AIBookingSessionRepository(db as unknown as D1Database);
  const now = "2026-10-17T00:00:00.000Z";
  try {
    db.sqlite.prepare(`
      INSERT INTO ai_booking_sessions (
        tenant_id, provider, conversation_id, status, booking_type, created_at, updated_at
      ) VALUES ('tenant-a', 'provider-a', 'conversation-a', 'awaiting_confirmation', 'appointment', ?, ?)
    `).run(now, now);
    assert.equal(await repository.recordConfirmationBlock("tenant-a", "provider-a", "conversation-a", "identity_missing_name", now), true);
    assert.equal(await repository.recordConfirmationBlock("tenant-b", "provider-a", "conversation-a", "identity_missing_name", now), false);
    assert.equal(await repository.claimBookingExecution("tenant-a", "provider-a", "conversation-a", "claim-a"), true);
    assert.equal(await repository.recordConfirmationBlock("tenant-a", "provider-a", "conversation-a", "identity_missing_number", now), false);
    assert.equal(await repository.markBookingCreationAttempt("tenant-a", "provider-a", "conversation-a", "claim-a", now), true);
    const session = await repository.find("tenant-a", "provider-a", "conversation-a");
    const data = JSON.parse(session?.dataJson ?? "{}");
    assert.equal(data.confirmationBlockReason, "identity_missing_name");
    assert.equal(data.executionClaimId, "claim-a");
    assert.equal(data.bookingCreationStatus, "in_progress");
  } finally {
    db.close();
  }
});

test(
  "AI booking refuses a disabled appointment capability before provider resolution",
  async () => {
    const db = new SqliteD1Database();

    try {
      await setTenantFeatureEnabled(
        db as unknown as D1Database,
        "ai-booking-feature-test-tenant",
        "booking_appointment",
        false,
      );

      const result = await processAIBooking(
        createInput(db, "appointment"),
      );

      assert.equal(result.handled, true);
      assert.equal(result.state, "collecting");
      assert.equal(
        result.message,
        "Appointment booking is not enabled for this business.",
      );
    } finally {
      db.close();
    }
  },
);

test(
  "AI booking refuses a disabled accommodation capability before provider resolution",
  async () => {
    const db = new SqliteD1Database();

    try {
      await setTenantFeatureEnabled(
        db as unknown as D1Database,
        "ai-booking-feature-test-tenant",
        "booking_accommodation",
        false,
      );

      const result = await processAIBooking(
        createInput(db, "accommodation"),
      );

      assert.equal(result.handled, true);
      assert.equal(result.state, "collecting");
      assert.equal(
        result.message,
        "Accommodation booking is not enabled for this business.",
      );
    } finally {
      db.close();
    }
  },
);

test(
  "AI booking feature lookup failure does not continue to provider resolution",
  async () => {
    const db = new SqliteD1Database();

    try {
      db.sqlite.exec(
        "DROP TABLE tenant_feature_settings",
      );

      await assert.rejects(
        processAIBooking(
          createInput(db, "appointment"),
        ),
        /tenant_feature_settings/i,
      );
    } finally {
      db.close();
    }
  },
);

test(
  "existing AI booking cancellation remains available when new appointments are disabled",
  async () => {
    const db = new SqliteD1Database();

    try {
      await setTenantFeatureEnabled(
        db as unknown as D1Database,
        "ai-booking-feature-test-tenant",
        "booking_appointment",
        false,
      );

      const result = await processAIBooking(
        createInput(db, "appointment", "cancel"),
      );

      assert.equal(result.handled, true);
      assert.equal(result.state, "cancelled");
      assert.equal(result.actionExecuted, false);
    } finally {
      db.close();
    }
  },
);

test("cancellation confirmation is not swallowed by confirmed-booking protection", async () => {
  const db = new SqliteD1Database();
  const now = "2026-10-18T00:00:00.000Z";
  try {
    db.sqlite.prepare(`
      INSERT INTO ai_booking_sessions (
        tenant_id, provider, conversation_id, status, booking_type,
        offering_id, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'confirmed', 'appointment', ?, ?, ?, ?)
    `).run(
      "ai-booking-feature-test-tenant",
      "unregistered-test-provider",
      "conversation-cancellation-confirmation",
      "calendar-1",
      JSON.stringify({ bookingId: "provider-appointment-1", pendingCancellation: true }),
      now,
      now,
    );
    const input = createInput(db, "appointment");
    input.conversationId = "conversation-cancellation-confirmation";
    input.currentMessage = "yes";
    const result = await processAIBooking(input);
    assert.notEqual(result.message, "Your appointment is already confirmed.");
    assert.equal(result.actionResult, "failed");
  } finally {
    db.close();
  }
});

test("GHL cancellation persists only after a cancelled appointment readback", async () => {
  const db = new SqliteD1Database();
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  try {
    await setTenantFeatureEnabled(db as unknown as D1Database, "ai-booking-feature-test-tenant", "booking_appointment", true);
    const input = createInput(db, "appointment", "cancel", "gohighlevel");
    input.context.provider = "gohighlevel";
    input.conversationId = "conversation-cancellation-readback";
    input.currentMessage = "yes";
    input.context.integrationRuntime = { credentials: { async resolve() { return { authType: "api_key", accessToken: "synthetic-token" }; } } } as never;
    input.context.tenant.integrations = { crm: { provider: "gohighlevel", credentials: { locationId: "location-1" } } } as never;
    db.sqlite.prepare(`
      INSERT INTO ai_booking_sessions (
        tenant_id, provider, conversation_id, status, booking_type,
        offering_id, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'confirmed', 'appointment', ?, ?, ?, ?)
    `).run("ai-booking-feature-test-tenant", "gohighlevel", input.conversationId, "calendar-1", JSON.stringify({ bookingId: "appointment-1", pendingCancellation: true }), input.occurredAt, input.occurredAt);
    let getCount = 0;
    globalThis.fetch = async (request, init) => {
      const current = new Request(request, init);
      requests.push(current);
      if (current.method === "GET") {
        getCount += 1;
        return Response.json({ event: { id: "appointment-1", calendarId: "calendar-1", locationId: "location-1", contactId: "test-customer", title: "Synthetic appointment", appointmentStatus: getCount === 1 ? "confirmed" : "cancelled", startTime: "2099-10-20T02:00:00.000Z", endTime: "2099-10-20T02:30:00.000Z" } });
      }
      return Response.json({ appointment: { id: "appointment-1", calendarId: "calendar-1", locationId: "location-1", contactId: "test-customer", title: "Synthetic appointment", appointmentStatus: "cancelled", startTime: "2099-10-20T02:00:00.000Z", endTime: "2099-10-20T02:30:00.000Z" } });
    };
    const result = await processAIBooking(input);
    assert.equal(result.state, "cancelled");
    assert.equal(requests.filter(request => request.method === "PUT").length, 1);
    assert.equal(requests.filter(request => request.method === "GET").length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("GHL cancellation readback mismatch remains unresolved and does not repeat the mutation", async () => {
  const db = new SqliteD1Database();
  const originalFetch = globalThis.fetch;
  let putCount = 0;
  try {
    await setTenantFeatureEnabled(db as unknown as D1Database, "ai-booking-feature-test-tenant", "booking_appointment", true);
    const input = createInput(db, "appointment", "cancel", "gohighlevel");
    input.context.provider = "gohighlevel";
    input.conversationId = "conversation-cancellation-mismatch";
    input.currentMessage = "yes";
    input.context.integrationRuntime = { credentials: { async resolve() { return { authType: "api_key", accessToken: "synthetic-token" }; } } } as never;
    input.context.tenant.integrations = { crm: { provider: "gohighlevel", credentials: { locationId: "location-1" } } } as never;
    db.sqlite.prepare(`
      INSERT INTO ai_booking_sessions (
        tenant_id, provider, conversation_id, status, booking_type,
        offering_id, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'confirmed', 'appointment', ?, ?, ?, ?)
    `).run("ai-booking-feature-test-tenant", "gohighlevel", input.conversationId, "calendar-1", JSON.stringify({ bookingId: "appointment-1", pendingCancellation: true }), input.occurredAt, input.occurredAt);
    globalThis.fetch = async (_request, init) => {
      const method = new Request(_request, init).method;
      if (method === "PUT") putCount += 1;
      return method === "PUT"
        ? Response.json({ appointment: { id: "appointment-1", calendarId: "calendar-1", locationId: "location-1", contactId: "test-customer", title: "Synthetic appointment", appointmentStatus: "cancelled", startTime: "2099-10-20T02:00:00.000Z", endTime: "2099-10-20T02:30:00.000Z" } })
        : Response.json({ event: { id: "appointment-1", calendarId: "calendar-1", locationId: "location-1", contactId: "other-customer", title: "Synthetic appointment", appointmentStatus: "confirmed", startTime: "2099-10-20T02:00:00.000Z", endTime: "2099-10-20T02:30:00.000Z" } });
    };
    const first = await processAIBooking(input);
    assert.equal(first.state, "confirmed");
    assert.equal(first.actionResult, "failed");
    const second = await processAIBooking(input);
    assert.equal(second.state, "confirmed");
    assert.equal(putCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test(
  "enabled GHL accommodation booking returns the configured Rentals URL",
  async () => {
    const db = new SqliteD1Database();
    const tenantId = "ai-booking-feature-test-tenant";
    const integrationId =
      "ai-booking-feature-test-integration";
    const rentalsUrl =
      "https://example.com/rentals/test-booking";

    try {
      await setTenantFeatureEnabled(
        db as unknown as D1Database,
        tenantId,
        "booking_accommodation",
        true,
      );

      db.sqlite
        .prepare(
          "INSERT INTO integrations (id, settings) VALUES (?, ?)",
        )
        .run(
          integrationId,
          JSON.stringify({
            providerConfiguration: {
              rentalsBookingUrl: rentalsUrl,
            },
          }),
        );

      const result = await processAIBooking(
        createInput(
          db,
          "accommodation",
          "start",
          "gohighlevel",
        ),
      );

      assert.equal(result.handled, true);
      assert.equal(result.state, "collecting");
      assert.ok(result.message.includes(rentalsUrl));
      assert.equal(result.actionExecuted, false);
      assert.equal(result.actionResult, "none");
    } finally {
      db.close();
    }
  },
);

test(
  "enabled GHL accommodation booking gives a safe fallback when the Rentals URL is missing",
  async () => {
    const db = new SqliteD1Database();
    const tenantId = "ai-booking-feature-test-tenant";
    const integrationId =
      "ai-booking-feature-test-integration";

    try {
      await setTenantFeatureEnabled(
        db as unknown as D1Database,
        tenantId,
        "booking_accommodation",
        true,
      );

      db.sqlite
        .prepare(
          "INSERT INTO integrations (id, settings) VALUES (?, ?)",
        )
        .run(
          integrationId,
          JSON.stringify({}),
        );

      const result = await processAIBooking(
        createInput(
          db,
          "accommodation",
          "start",
          "gohighlevel",
        ),
      );

      assert.equal(result.handled, true);
      assert.equal(result.state, "collecting");
      assert.match(
        result.message,
        /can't access the accommodation booking page/i,
      );
      assert.equal(result.actionExecuted, false);
      assert.equal(result.actionResult, "none");
    } finally {
      db.close();
    }
  },
);

async function withAppointmentConversation(
  run: (fixture: {
    turn: (text: string, action?: BookingIntent["action"], bookingType?: BookingIntent["bookingType"]) => ReturnType<typeof processAIBooking>;
    requests: Request[];
    configure: (changes: Partial<{ reversed: boolean; available: boolean; availableStart: string | null; alternativeSlots: boolean; failAvailability: boolean; status: string; failCreate: boolean; failReadback: boolean; failIdentityLoad: boolean; failIdentityUpdate: boolean; omitWoundCalendar: boolean; failCalendarList: boolean; failCalendarDetails: boolean; fullName: string | null; identityNumber: string | null; phone: string | null; intentResponse: string | null; intentFinishReason: string | null }>) => void;
    configurePatientFields: (calendarId: string, requirements: Record<string, unknown> | null) => void;
    configureLegacyPatientFields: (calendarId: string, requirements: Record<string, unknown> | null) => void;
    setSessionData: (changes: Record<string, unknown>) => void;
  }) => Promise<void>,
): Promise<void> {
  const db = new SqliteD1Database();
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  const settings = { reversed: false, available: true, availableStart: null as string | null, alternativeSlots: true, failAvailability: false, status: "confirmed", failCreate: false, failReadback: false, failIdentityLoad: false, failIdentityUpdate: false, omitWoundCalendar: false, failCalendarList: false, failCalendarDetails: false, fullName: null as string | null, identityNumber: null as string | null, phone: null as string | null, intentResponse: null as string | null, intentFinishReason: null as string | null };
  const history: MessagingMessage[] = [];
  const context = {
    tenant: {
      id: "synthetic-appointment-tenant",
      integrations: {
        crm: {
          provider: "gohighlevel",
          credentials: { locationId: "location-test" },
          configuration: {
            providerConfiguration: {
              booking: {
                offerings: {
                  general: { requiredFields: [], persistence: { target: "none", mode: "none" } },
                  wound: { requiredFields: [], persistence: { target: "none", mode: "none" } },
                },
              },
            },
          },
        },
      },
    },
    provider: "gohighlevel",
    requestId: "appointment-conversation-test",
    receivedAt: new Date("2026-10-18T00:00:00Z"),
    integrationRuntime: {
      credentials: { async resolve() { return { authType: "api_key", accessToken: "test-only" }; } },
    },
    patientIdentity: {
      async load() {
        if (settings.failIdentityLoad) throw new Error("Synthetic identity readback failure");
        return { fullName: settings.fullName, identityNumber: settings.identityNumber, phone: settings.phone, identityType: "passport" };
      },
      async update(_customerId: string, identity: { fullName: string | null; identityNumber: string | null; phone: string | null; identityType?: string | null }) {
        if (settings.failIdentityUpdate) throw new Error("Synthetic identity update failure");
        settings.fullName = identity.fullName;
        settings.identityNumber = identity.identityNumber;
        settings.phone = identity.phone;
        return identity;
      },
    },
  } as unknown as IntegrationContext;
  const calendars = [
    { id: "general", name: "General Consultation", locationId: "location-test" },
    { id: "wound", name: "Wound Care", locationId: "location-test" },
    { id: "foreign", name: "Wound Care", locationId: "different-location" },
  ];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    let body: unknown;
    if (url.pathname === "/calendars/") {
      if (settings.failCalendarList) throw new Error("Synthetic calendar discovery failure");
      const visibleCalendars = settings.omitWoundCalendar
        ? calendars.filter(calendar => calendar.id !== "wound")
        : calendars;
      body = { calendars: settings.reversed ? [...visibleCalendars].reverse() : visibleCalendars };
    } else if (url.pathname.endsWith("/free-slots")) {
      assert.equal(url.pathname, "/calendars/wound/free-slots");
      assert.equal(url.searchParams.get("timezone"), "Asia/Kuala_Lumpur");
      if (settings.failAvailability) throw new Error("Synthetic availability failure");
      body = { "2099-10-20": { slots: settings.available
        ? [settings.availableStart ?? "2099-10-20T02:00:00.000Z"]
        : settings.alternativeSlots
          ? ["2099-10-20T03:00:00.000Z", "2099-10-20T04:00:00.000Z", "2099-10-20T01:00:00.000Z"]
          : [] } };
    } else if (url.pathname === "/calendars/events/appointments" && request.method === "POST") {
      if (settings.failCreate) throw new TypeError("Synthetic create response failure");
      const submitted = await request.json() as Record<string, unknown>;
      assert.equal(submitted.calendarId, "wound");
      const expectedStart = settings.availableStart ?? "2099-10-20T02:00:00.000Z";
      const expectedEnd = new Date(new Date(expectedStart).getTime() + 30 * 60 * 1000).toISOString();
      assert.equal(submitted.startTime, expectedStart);
      assert.equal(submitted.endTime, expectedEnd);
      body = { appointment: {
        ...submitted, id: "appointment-test", appointmentStatus: settings.status,
      } };
    } else if (url.pathname === "/calendars/events/appointments/appointment-test" && request.method === "PUT") {
      settings.status = "cancelled";
      body = { appointment: {
        id: "appointment-test", calendarId: "wound", locationId: "location-test", contactId: "customer-test",
        title: "Synthetic appointment", appointmentStatus: "cancelled",
        startTime: settings.availableStart ?? "2099-10-20T02:00:00.000Z",
        endTime: new Date(new Date(settings.availableStart ?? "2099-10-20T02:00:00.000Z").getTime() + 30 * 60 * 1000).toISOString(),
      } };
    } else if (url.pathname === "/calendars/events/appointments/appointment-test") {
      if (settings.failReadback) throw new TypeError("Synthetic readback transport failure");
      body = { event: {
        id: "appointment-test", calendarId: "wound", locationId: "location-test", contactId: "customer-test",
        title: "Synthetic appointment", appointmentStatus: settings.status,
        startTime: settings.availableStart ?? "2099-10-20T02:00:00.000Z",
        endTime: new Date(new Date(settings.availableStart ?? "2099-10-20T02:00:00.000Z").getTime() + 30 * 60 * 1000).toISOString(),
      } };
    } else if (/^\/calendars\/(general|wound)$/.test(url.pathname)) {
      if (settings.failCalendarDetails) throw new Error("Synthetic calendar detail failure");
      const id = url.pathname.split("/").at(-1);
      body = { calendar: { id, locationId: "location-test", name: id, slotDuration: 30, slotDurationUnit: "mins" } };
    } else {
      throw new Error(`Unexpected mocked booking endpoint: ${url.pathname}`);
    }
    return Response.json(body);
  };
  try {
    await setTenantFeatureEnabled(db as unknown as D1Database, context.tenant.id, "booking_appointment", true);
    await run({
      requests,
      configure(changes) { Object.assign(settings, changes); },
      configurePatientFields(calendarId, requirements) {
        const providerConfiguration = context.tenant.integrations.crm.configuration
          ?.providerConfiguration as { booking?: { offerings?: Record<string, unknown> } };
        if (!providerConfiguration?.booking?.offerings) throw new Error("Missing test calendar configuration");
        if (requirements === null) delete providerConfiguration.booking.offerings[calendarId];
        else {
          const fields = Array.isArray(requirements.fields) ? requirements.fields.map((field) =>
            field === "full_name" ? "customer.fullName" : field === "identity_number" ? "customer.identityNumber" : field === "phone" ? "customer.phone" : field,
          ) : requirements.requiredFields;
          providerConfiguration.booking.offerings[calendarId] = {
            requiredFields: fields,
            persistence: requirements.persistence ?? {
              target: requirements.persistToContact ? "crm.contact" : "none",
              mode: requirements.requirePersistence ? "required" : requirements.persistToContact ? "optional" : "none",
            },
          };
        }
      },
      configureLegacyPatientFields(calendarId, requirements) {
        const providerConfiguration = context.tenant.integrations.crm.configuration
          ?.providerConfiguration as Record<string, unknown>;
        delete providerConfiguration.booking;
        const legacy = (providerConfiguration.appointmentPatientFieldsByCalendar ??= {}) as Record<string, unknown>;
        if (requirements === null) delete legacy[calendarId];
        else legacy[calendarId] = requirements;
      },
      setSessionData(changes) {
        const row = db.sqlite.prepare("SELECT data_json FROM ai_booking_sessions WHERE tenant_id = ? AND provider = ? AND conversation_id = ?")
          .get(context.tenant.id, context.provider, "appointment-conversation") as { data_json: string };
        const data = { ...JSON.parse(row.data_json), ...changes } as Record<string, unknown>;
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) delete data[key];
        }
        db.sqlite.prepare("UPDATE ai_booking_sessions SET data_json = ? WHERE tenant_id = ? AND provider = ? AND conversation_id = ?")
          .run(JSON.stringify(data), context.tenant.id, context.provider, "appointment-conversation");
      },
      async turn(text, action = "none", bookingTypeOverride) {
        const ai: AIProvider = {
          async chat() {
            return {
              text: settings.intentResponse ?? JSON.stringify({
                ...createIntent("appointment"),
                ...(bookingTypeOverride === undefined ? {} : { bookingType: bookingTypeOverride }),
                action, offeringQuery: null,
                // Deliberately unsupported model suggestions must never become patient preferences.
                date: "2099-12-31", time: "15:00", start: "2099-12-31T07:00:00.000Z", end: "2099-12-31T07:30:00.000Z",
              }),
              finishReason: settings.intentFinishReason ?? undefined,
              provider: "test", model: "test",
            };
          },
        };
        const occurredAt = `2026-10-18T00:00:${String(history.length).padStart(2, "0")}.000Z`;
        const result = await processAIBooking({
          db: db as unknown as D1Database, context, ai, history, currentMessage: text,
          occurredAt, conversationId: "appointment-conversation", customerId: "customer-test",
          timezone: "Asia/Kuala_Lumpur",
        });
        history.push({
          id: `message-${history.length + 1}`,
          conversationId: "appointment-conversation",
          contactId: "customer-test",
          direction: "inbound",
          text,
          timestamp: occurredAt,
          senderType: "customer",
        });
        return result;
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
}

test("appointment preference parser accepts natural, numeric, and relative patient dates", () => {
  const occurredAt = "2026-10-18T00:00:00.000Z";
  const cases = [
    ["25th October", "2026-10-25", null],
    ["25 October 2026 at 14:00", "2026-10-25", "14:00"],
    ["25/10/26 2pm", "2026-10-25", "14:00"],
    ["2026/10/25,2PM", "2026-10-25", "14:00"],
    ["2026-10-25 14:00", "2026-10-25", "14:00"],
    ["tomorrow", "2026-10-19", null],
    ["next Monday", "2026-10-19", null],
  ] as const;
  for (const [message, date, time] of cases) {
    const result = parseAppointmentPreference(message, occurredAt, "Asia/Kuala_Lumpur");
    assert.equal(result.date, date, message);
    assert.equal(result.time, time, message);
    assert.equal(result.error, null, message);
  }
  const partial = parseAppointmentPreference("25th October", occurredAt, "Asia/Kuala_Lumpur");
  assert.equal(partial.date, "2026-10-25");
  assert.equal(partial.time, null);
  const invalid = parseAppointmentPreference("31/02/2026", occurredAt, "Asia/Kuala_Lumpur");
  assert.match(invalid.error ?? "", /valid/i);
  const ambiguous = parseAppointmentPreference("25 October at 2", occurredAt, "Asia/Kuala_Lumpur");
  assert.equal(ambiguous.date, "2026-10-25");
  assert.match(ambiguous.error ?? "", /AM or PM/i);
});

test("calendar policy collects each required patient field and keeps raw values out of session state", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields, requests }) => {
    configurePatientFields("wound", { fields: ["full_name", "identity_number"] });
    await turn("Book an appointment", "start");
    await turn("2");
    const details = await turn("2099-10-20 at 10am");
    assert.equal(details.state, "collecting");
    assert.match(details.message, /full name/i);
    assert.equal(details.session?.startAt, "2099-10-20T02:00:00.000Z");

    const name = await turn("My name is Ada Patient");
    assert.equal(name.state, "collecting");
    assert.match(name.message, /IC or passport/i);
    const summary = await turn("My passport number is P1234567");
    assert.equal(summary.state, "awaiting_confirmation");
    assert.match(summary.message, /Ada Patient/);
    assert.match(summary.message, /\*{4,}4567/);
    assert.doesNotMatch(summary.message, /P1234567/);
    assert.doesNotMatch(summary.session?.dataJson ?? "", /Ada Patient|P1234567/);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);

    const confirmed = await turn("yes");
    assert.equal(confirmed.state, "confirmed");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

test("patient identity fields supplied together reach one confirmation without a collection loop", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields, requests }) => {
    configurePatientFields("wound", { fields: ["full_name", "identity_number", "phone"] });
    await turn("Book an appointment", "start");
    await turn("2");
    const details = await turn("2099-10-20 at 10am");
    assert.equal(details.state, "collecting");

    const summary = await turn("My name is Ada Patient, my passport number is P1234567 and my phone is +60 12-345 6789");
    assert.equal(summary.state, "awaiting_confirmation");
    assert.match(summary.message, /Ada Patient/);
    assert.match(summary.message, /\*{4,}6789/);
    assert.doesNotMatch(summary.message, /P1234567|\+60123456789/);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  });
});

test("pending identity collection accepts standalone numeric and passport values", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
    configurePatientFields("wound", { fields: ["full_name", "identity_number", "phone"] });
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    const name = await turn("My name is Azar Test");
    assert.equal(name.state, "collecting");
    assert.match(name.message, /IC or passport/i);

    const invalid = await turn("123");
    assert.equal(invalid.state, "collecting");
    assert.match(invalid.message, /couldn't validate|at least 5/i);

    const numeric = await turn("0101010");
    assert.equal(numeric.state, "collecting");
    assert.match(numeric.message, /mobile number/i);
    const numericSummary = await turn("+60 12-345 6789");
    assert.equal(numericSummary.state, "awaiting_confirmation");
    assert.match(numericSummary.message, /\*{3,}1010/);
    assert.doesNotMatch(numericSummary.session?.dataJson ?? "", /0101010|\+60123456789/);
  });

  await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
    configurePatientFields("wound", { fields: ["full_name", "identity_number", "phone"] });
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    await turn("My name is Azar Test");
    const passport = await turn("P1234567");
    assert.equal(passport.state, "collecting");
    assert.match(passport.message, /mobile number/i);
    const passportSummary = await turn("+91 98765 43210");
    assert.equal(passportSummary.state, "awaiting_confirmation");
    assert.match(passportSummary.message, /\*{4,}4567/);
    assert.match(passportSummary.message, /\*{4,}3210/);
    assert.doesNotMatch(passportSummary.session?.dataJson ?? "", /P1234567|\+919876543210/);
  });
});

test("truncated booking intent cannot prevent deterministic confirmation of a ready appointment", async () => {
  await withAppointmentConversation(async ({ turn, configure, configurePatientFields, requests }) => {
    configurePatientFields("wound", { fields: ["full_name", "identity_number"] });
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    await turn("My name is Ada Patient");
    await turn("My passport number is P1234567");

    configure({ intentResponse: '{"action":"confirm","bookingType":"appointment"', intentFinishReason: "length" });
    const confirmed = await turn("yes");
    assert.equal(confirmed.state, "confirmed");
    assert.equal(confirmed.actionResult, "success");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

test("calendar policies can require a different field set", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
    configurePatientFields("wound", { fields: ["full_name"] });
    await turn("Book an appointment", "start");
    await turn("Wound Care");
    const details = await turn("2099-10-20 at 10am");
    assert.match(details.message, /full name/i);
    assert.doesNotMatch(details.message, /IC or passport/i);
    const summary = await turn("My name is Ada Patient");
    assert.equal(summary.state, "awaiting_confirmation");
  });
});

test("existing linked contact name and phone are explicitly collected for a fresh booking", async () => {
  await withAppointmentConversation(async ({ turn, configure, configurePatientFields }) => {
    configure({ fullName: "Ada Patient", identityNumber: "P1234567", phone: "+60123456789" });
    configurePatientFields("wound", { fields: ["full_name", "identity_number", "phone"] });
    await turn("Book an appointment", "start");
    await turn("Wound Care");
    const details = await turn("2099-10-20 at 10am");
    assert.equal(details.state, "collecting");
    assert.match(details.message, /full name/i);
    const name = await turn("My name is Ada Patient");
    assert.equal(name.state, "collecting");
    assert.match(name.message, /mobile number/i);
    const result = await turn("My phone is +60 12-345 6789");
    assert.equal(result.state, "awaiting_confirmation");
    assert.match(result.message, /Ada Patient/);
    assert.match(result.message, /\*{4,}4567/);
    assert.match(result.message, /\*{4,}6789/);
  });
});

test("full synthetic booking completes alternative selection, fresh identity collection, confirmation, and verified readback", async () => {
  await withAppointmentConversation(async ({ turn, configure, configurePatientFields, requests }) => {
    configure({ fullName: "Existing Contact", identityNumber: "P1234567", phone: "+60112223333", available: false });
    configurePatientFields("wound", { fields: ["full_name", "phone"] });

    const menu = await turn("Book an appointment", "start");
    assert.equal(menu.state, "collecting");
    const service = await turn("2");
    assert.equal(service.session?.offeringId, "wound");

    const unavailable = await turn("2099-10-20 at 10:00");
    assert.equal(unavailable.state, "awaiting_slot_selection");
    const alternative = await turn("option 2");
    assert.equal(alternative.state, "collecting");
    assert.equal(alternative.session?.offeringId, "wound");
    assert.equal(alternative.session?.startAt, "2099-10-20T03:00:00.000Z");
    assert.match(alternative.message, /full name/i);

    const name = await turn("My name is Ada Patient");
    assert.equal(name.state, "collecting");
    assert.match(name.message, /mobile number with country code/i);
    assert.doesNotMatch(name.message, /IC or passport/i);
    const phone = await turn("+60 12-345 6789");
    assert.equal(phone.state, "awaiting_confirmation");
    assert.match(phone.message, /Wound Care/);
    assert.match(phone.message, /Ada Patient/);
    assert.match(phone.message, /\*{4,}6789/);
    assert.doesNotMatch(phone.message, /IC or passport|P1234567/);
    assert.doesNotMatch(phone.message, /Existing Contact|\+60123456789/);
    assert.doesNotMatch(phone.session?.dataJson ?? "", /Ada Patient|\+60123456789/);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);

    configure({ available: true, availableStart: "2099-10-20T03:00:00.000Z" });
    const confirmed = await turn("yes");
    assert.equal(confirmed.state, "confirmed");
    assert.match(confirmed.message, /confirmed|booked/i);
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
    assert.equal(requests.filter(request => request.url.endsWith("/appointment-test") && request.method === "GET").length, 1);

    const repeated = await turn("yes");
    assert.equal(repeated.state, "confirmed");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

test("invalid phone input remains incomplete until a valid phone is supplied", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
    configurePatientFields("wound", { fields: ["phone"] });
    await turn("Book an appointment", "start");
    await turn("Wound Care");
    const missing = await turn("2099-10-20 at 10am");
    assert.equal(missing.state, "collecting");
    assert.match(missing.message, /mobile number/i);
    const invalid = await turn("My phone is 123");
    assert.equal(invalid.state, "collecting");
    assert.match(invalid.message, /country code/i);
    const local = await turn("My phone is 017627182");
    assert.equal(local.state, "collecting");
    assert.match(local.message, /country code/i);
    const confirmed = await turn("My phone is +60 12-345 6789");
    assert.equal(confirmed.state, "awaiting_confirmation");
    assert.match(confirmed.message, /\*{4,}6789/);
    assert.doesNotMatch(confirmed.message, /60123456789/);
  });
});

for (const phone of ["+60 12-345 6789", "+65 8123 4567", "+91 98765 43210", "0060 12-345 6789"]) {
  test(`international phone ${phone} completes full-name and phone collection`, async () => {
    await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
      configurePatientFields("wound", { fields: ["full_name", "phone"] });
      await turn("Book an appointment", "start");
      await turn("Wound Care");
      await turn("2099-10-20 at 10am");
      const name = await turn("My name is Ada Patient");
      assert.equal(name.state, "collecting");
      assert.match(name.message, /mobile number with country code/i);
      const completed = await turn(phone);
      assert.equal(completed.state, "awaiting_confirmation");
      assert.doesNotMatch(completed.message, /IC or passport/i);
      assert.match(completed.message, /\*{4,}\d{4}/);
      assert.doesNotMatch(completed.session?.dataJson ?? "", new RegExp(phone.replace(/\D/g, "")));
    });
  });
}

test("legacy calendar patient fields remain supported when no generic booking policy is configured", async () => {
  await withAppointmentConversation(async ({ turn, configureLegacyPatientFields }) => {
    configureLegacyPatientFields("wound", { fields: ["full_name"] });
    await turn("Book an appointment", "start");
    await turn("Wound Care");
    const details = await turn("2099-10-20 at 10am");
    assert.equal(details.state, "collecting");
    assert.match(details.message, /full name/i);
    assert.doesNotMatch(details.message, /IC or passport/i);
  });
});

test("patient details supplied earlier in the appointment conversation are reused after slot validation", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
    configurePatientFields("wound", { fields: ["full_name", "identity_number"] });
    await turn("Book an appointment", "start");
    await turn("Wound Care");
    await turn("My name is Ada Patient");
    await turn("My passport number is P1234567");
    const summary = await turn("2099-10-20 at 10am");
    assert.equal(summary.state, "awaiting_confirmation");
    assert.match(summary.message, /Ada Patient/);
    assert.match(summary.message, /\*{4,}4567/);
    assert.doesNotMatch(summary.session?.dataJson ?? "", /Ada Patient|P1234567/);
  });
});

test("missing calendar patient-field configuration fails closed before a confirmation", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields, requests }) => {
    configurePatientFields("wound", null);
    await turn("Book an appointment", "start");
    const result = await turn("Wound Care");
    assert.equal(result.state, "collecting");
    assert.match(result.message, /missing.*patient-information configuration/i);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  });
});

test("missing policy preserves the selected calendar and validated slot, then recovers after configuration is restored", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    const ready = await turn("2099-10-20 at 10am");
    assert.equal(ready.state, "awaiting_confirmation");
    configurePatientFields("wound", null);
    const blocked = await turn("continue");
    assert.equal(blocked.state, "collecting");
    assert.match(blocked.message, /missing.*configuration/i);
    assert.equal(blocked.session?.offeringId, "wound");
    assert.equal(blocked.session?.startAt, "2099-10-20T02:00:00.000Z");
    configurePatientFields("wound", { fields: [] });
    const recovered = await turn("continue");
    assert.equal(recovered.state, "awaiting_confirmation");
    assert.equal(recovered.session?.offeringId, "wound");
    assert.match(recovered.message, /confirm/i);
  });
});

test("malformed calendar policy is reported separately from a missing policy", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
    configurePatientFields("wound", { fields: ["passport_number"] });
    await turn("Book an appointment", "start");
    const result = await turn("Wound Care");
    assert.equal(result.state, "collecting");
    assert.match(result.message, /unavailable.*configuration/i);
    assert.equal(result.session?.offeringId, "wound");
  });
});

test("a calendar removed from GHL is not silently replaced and retains the session identity", async () => {
  await withAppointmentConversation(async ({ turn, configure }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    const ready = await turn("2099-10-20 at 10am");
    assert.equal(ready.state, "awaiting_confirmation");
    configure({ omitWoundCalendar: true });
    const result = await turn("continue");
    assert.equal(result.state, "collecting");
    assert.match(result.message, /no longer available/i);
    assert.equal(result.session?.offeringId, "wound");
    assert.equal(result.session?.startAt, "2099-10-20T02:00:00.000Z");
  });
});

test("temporary calendar discovery failure preserves the selected calendar", async () => {
  await withAppointmentConversation(async ({ turn, configure }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    configure({ failCalendarList: true });
    const result = await turn("2099-10-20 at 10am");
    assert.equal(result.state, "collecting");
    assert.match(result.message, /couldn't verify.*calendar/i);
    assert.equal(result.session?.offeringId, "wound");
  });
});

test("temporary calendar detail failure is reported as resolution failure", async () => {
  await withAppointmentConversation(async ({ turn, configure }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    configure({ failCalendarDetails: true });
    const result = await turn("2099-10-20 at 10am");
    assert.equal(result.state, "collecting");
    assert.match(result.message, /couldn't verify.*calendar/i);
    assert.equal(result.session?.offeringId, "wound");
  });
});

test("required contact persistence failure blocks confirmation without a provider create", async () => {
  await withAppointmentConversation(async ({ turn, configure, configurePatientFields, requests }) => {
    configurePatientFields("wound", {
      fields: ["full_name"], persistToContact: true, requirePersistence: true,
    });
    configure({ failIdentityUpdate: true });
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    const blocked = await turn("My name is Ada Patient");
    assert.equal(blocked.state, "collecting");
    assert.match(blocked.message, /couldn't save.*patient information/i);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  });
});

test("optional contact persistence failure does not loop patient collection", async () => {
  await withAppointmentConversation(async ({ turn, configure, configurePatientFields, requests }) => {
    configurePatientFields("wound", {
      fields: ["full_name"], persistToContact: true, requirePersistence: false,
    });
    configure({ failIdentityUpdate: true });
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    const summary = await turn("My name is Ada Patient");
    assert.equal(summary.state, "awaiting_confirmation");
    const confirmed = await turn("yes");
    assert.equal(confirmed.state, "confirmed");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

test("calendar patient-detail diagnostics contain no patient details", async () => {
  const originalLog = console.log;
  const branchRecords: Record<string, unknown>[] = [];
  const detailDiagnostics: Record<string, unknown>[] = [];
  console.log = (...args: unknown[]) => {
    if (args[0] === "AI BOOKING CONFIRMATION BRANCH") {
      branchRecords.push(args[1] as Record<string, unknown>);
    }
    if (args[0] === "AI BOOKING PATIENT DETAILS DIAGNOSTIC") {
      detailDiagnostics.push(args[1] as Record<string, unknown>);
    }
  };
  try {
    await withAppointmentConversation(async ({ turn, configurePatientFields }) => {
      configurePatientFields("wound", { fields: ["full_name", "identity_number"] });
      await turn("Book an appointment", "start");
      await turn("2");
      await turn("2099-10-20 at 10am");
      await turn("My name is Ada Patient");
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(branchRecords.some(record => record.branch === "patient_details"));
  assert.ok(detailDiagnostics.length > 0);
  assert.deepEqual(detailDiagnostics.at(-1)?.requiredFields, ["customer.fullName", "customer.identityNumber"]);
  assert.equal(detailDiagnostics.at(-1)?.affirmativeConfirmation, false);
  assert.doesNotMatch(JSON.stringify([...branchRecords, ...detailDiagnostics]), /Ada Patient|P1234567|customer-test/);
});

test("patient-detail diagnostics distinguish missing status from ineligible history", async () => {
  const originalLog = console.log;
  const diagnostics: Record<string, unknown>[] = [];
  console.log = (...args: unknown[]) => {
    if (args[0] === "AI BOOKING PATIENT DETAILS DIAGNOSTIC") {
      diagnostics.push(args[1] as Record<string, unknown>);
    }
  };
  try {
    await withAppointmentConversation(async ({ turn, configurePatientFields, setSessionData }) => {
      configurePatientFields("wound", { fields: ["full_name", "identity_number"] });
      await turn("Book an appointment", "start");
      await turn("2");
      await turn("2099-10-20 at 10am");

      setSessionData({
        patientDetailsStatus: undefined,
        patientCollectionStartedAt: "2026-10-18T00:00:00.000Z",
      });
      await turn("yes");
      assert.equal(diagnostics.at(-1)?.reason, "missing_persisted_status");
      assert.equal(diagnostics.at(-1)?.eligibleInboundHistoryCount, 3);

      setSessionData({
        patientDetailsStatus: undefined,
        patientCollectionStartedAt: "2099-12-31T00:00:00.000Z",
      });
      await turn("yes");
      assert.equal(diagnostics.at(-1)?.reason, "missing_eligible_history");
      assert.equal(diagnostics.at(-1)?.eligibleInboundHistoryCount, 0);
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(diagnostics.length >= 2);
  assert.doesNotMatch(JSON.stringify(diagnostics), /Ada Patient|P1234567|customer-test/);
});

test("a stale booking reference blocks a second provider create", async () => {
  await withAppointmentConversation(async ({ turn, setSessionData, requests }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    setSessionData({ bookingId: "prior-appointment-reference" });
    const first = await turn("yes");
    const second = await turn("yes");
    assert.equal(first.state, "awaiting_confirmation");
    assert.equal(second.state, "awaiting_confirmation");
    assert.equal(first.actionResult, "uncertain");
    assert.match(first.message, /team can verify.*before another booking/i);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  });
});

test("uncertain provider creation is fenced across repeated confirmation", async () => {
  await withAppointmentConversation(async ({ turn, configure, requests }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    configure({ failCreate: true });
    const first = await turn("yes");
    const second = await turn("yes");
    assert.equal(first.state, "awaiting_confirmation");
    assert.equal(first.actionResult, "uncertain");
    assert.equal(second.actionResult, "uncertain");
    assert.equal(JSON.parse(second.session?.dataJson ?? "{}").bookingCreationStatus, "uncertain");
    assert.match(second.message, /team will verify.*before another booking/i);
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

test("a new appointment after cancellation does not reuse the cancelled booking", async () => {
  await withAppointmentConversation(async ({ turn, requests, configure }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    const first = await turn("yes");
    assert.equal(first.state, "confirmed");
    assert.equal(JSON.parse(first.session?.dataJson ?? "{}").bookingId, "appointment-test");

    const cancellationRequested = await turn("cancel my appointment");
    assert.match(cancellationRequested.message, /confirm.*cancel/i);
    const cancelled = await turn("yes");
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.actionResult, "success");
    assert.equal(JSON.parse(cancelled.session?.dataJson ?? "{}").bookingId, "appointment-test");

    // The next booking starts with a service selection rather than relying on
    // the model to emit a separate "start" action.
    configure({ status: "confirmed" });
    const secondService = await turn("Wound Care", "continue", null);
    assert.equal(secondService.session?.status, "collecting");
    assert.equal(secondService.session?.offeringId, "wound");
    assert.equal(JSON.parse(secondService.session?.dataJson ?? "{}").bookingId, undefined);
    assert.match(secondService.message, /date and time/i);

    const secondPreference = await turn("2099-10-20 at 10am", "continue");
    assert.equal(secondPreference.state, "awaiting_confirmation");
    const second = await turn("yes");
    assert.equal(second.state, "confirmed");
    assert.equal(second.actionResult, "success");
    assert.equal(requests.filter(request => request.method === "POST").length, 2);
  });
});

test("numeric appointment selection follows the displayed order and collects patient date/time before GHL availability", async () => {
  await withAppointmentConversation(async ({ turn, requests, configure }) => {
    const menu = await turn("Book an appointment", "start");
    assert.match(menu.message, /1\. General Consultation\s+2\. Wound Care/);
    assert.doesNotMatch(menu.message, /foreign|2099/);
    configure({ reversed: true });
    const service = await turn("2");
    assert.equal(service.session?.offeringId, "wound");
    assert.match(service.message, /date and time.*Wound Care/i);
    assert.doesNotMatch(service.message, /Which appointment|1\.|2\.|2099/);
    assert.equal(requests.filter(request => request.url.includes("free-slots")).length, 0);
    const date = await turn("2099-10-20");
    assert.match(date.message, /What time/i);
    assert.equal(requests.filter(request => request.url.includes("free-slots")).length, 0);
    const time = await turn("10am");
    assert.equal(time.state, "awaiting_confirmation");
    assert.equal(time.session?.startAt, "2099-10-20T02:00:00.000Z");
    assert.match(time.message, /Wound Care/);
    assert.equal(requests.filter(request => request.url.includes("free-slots")).length, 1);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
    const confirmed = await turn("yes");
    assert.equal(confirmed.state, "confirmed");
    assert.match(confirmed.message, /confirmed/i);
    await turn("yes");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

for (const selection of ["Wound Care", "wound care", "woundcare", "I want wound care"]) {
  test(`appointment service alias '${selection}' persists selection and supports time before date`, async () => {
    await withAppointmentConversation(async ({ turn, requests }) => {
      await turn("Book an appointment", "start");
      const service = await turn(selection);
      assert.equal(service.session?.offeringId, "wound");
      assert.match(service.message, /date and time/i);
      const time = await turn("10am");
      assert.match(time.message, /What date/i);
      assert.equal(requests.filter(request => request.url.includes("free-slots")).length, 0);
      const date = await turn("2099-10-20");
      assert.equal(date.state, "awaiting_confirmation");
      assert.equal(date.session?.startAt, "2099-10-20T02:00:00.000Z");
    });
  });
}

test("unavailable patient preference offers verified nearby times and rechecks the selected slot", async () => {
  await withAppointmentConversation(async ({ turn, configure, requests }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    configure({ available: false });
    const result = await turn("2099-10-20 at 10:00");
    assert.equal(result.state, "awaiting_slot_selection");
    assert.equal(result.session?.startAt, null);
    assert.match(result.message, /available times/i);
    assert.match(result.message, /11:00 AM|12:00 PM|9:00 AM/i);
    const selected = await turn("option 2");
    assert.equal(selected.state, "awaiting_confirmation");
    assert.equal(selected.session?.startAt, "2099-10-20T03:00:00.000Z");
    configure({ available: true, availableStart: "2099-10-20T03:00:00.000Z" });
    const confirmed = await turn("yes");
    assert.equal(confirmed.state, "confirmed");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

test("an offered alternative that disappears before selection is rejected safely", async () => {
  await withAppointmentConversation(async ({ turn, configure, requests }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    configure({ available: false });
    const unavailable = await turn("2099-10-20 at 10:00");
    assert.equal(unavailable.state, "awaiting_slot_selection");
    assert.ok(unavailable.session?.pendingSlotsJson);

    configure({ alternativeSlots: false });
    const stale = await turn("option 2");
    assert.notEqual(stale.state, "awaiting_confirmation");
    assert.equal(stale.session?.startAt, null);
    assert.equal(stale.session?.pendingSlotsJson, null);
    assert.match(stale.message, /other date and time|verified/i);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  });
});

test("customer can change an alternative slot and the replacement is checked before confirmation", async () => {
  await withAppointmentConversation(async ({ turn, configure, configurePatientFields, requests }) => {
    configurePatientFields("wound", { fields: ["full_name", "phone"] });
    await turn("Book an appointment", "start");
    await turn("2");
    configure({ available: false });
    await turn("2099-10-20 at 10:00");
    const selected = await turn("option 2");
    assert.equal(selected.state, "collecting");
    assert.equal(selected.session?.startAt, "2099-10-20T03:00:00.000Z");
    assert.match(selected.message, /full name/i);
    await turn("My name is Ada Patient");
    const initialSummary = await turn("+60 12-345 6789");
    assert.equal(initialSummary.state, "awaiting_confirmation");

    configure({ available: true, availableStart: "2099-10-20T05:00:00.000Z" });
    const changed = await turn("2099-10-20 at 1pm", "continue");
    assert.equal(changed.state, "awaiting_confirmation", changed.message);
    assert.equal(changed.session?.startAt, "2099-10-20T05:00:00.000Z");
    assert.match(changed.message, /Ada Patient/);
    assert.match(changed.message, /\*{4,}6789/);
    assert.doesNotMatch(changed.message, /full name|mobile number/i);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);

    const confirmed = await turn("yes");
    assert.equal(confirmed.state, "confirmed");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  });
});

test("declining the final booking confirmation never creates an appointment", async () => {
  await withAppointmentConversation(async ({ turn, configurePatientFields, requests }) => {
    configurePatientFields("wound", { fields: ["full_name", "phone"] });
    await turn("Book an appointment", "start");
    await turn("2");
    await turn("2099-10-20 at 10am");
    await turn("My name is Ada Patient");
    const summary = await turn("+60 12-345 6789");
    assert.equal(summary.state, "awaiting_confirmation");

    const declined = await turn("no");
    assert.equal(declined.state, "awaiting_confirmation");
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  });
});

for (const selection of ["the second one", "11:00 AM"]) {
  test(`alternative appointment selection accepts ${selection}`, async () => {
    await withAppointmentConversation(async ({ turn, configure }) => {
      await turn("Book an appointment", "start");
      await turn("2");
      configure({ available: false });
      await turn("2099-10-20 at 10:00");
      const selected = await turn(selection);
      assert.equal(selected.state, "awaiting_confirmation");
      assert.equal(selected.session?.startAt, "2099-10-20T03:00:00.000Z");
    });
  });
}

test("unavailable patient preference with no verified alternatives remains safe", async () => {
  await withAppointmentConversation(async ({ turn, configure }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    configure({ available: false, alternativeSlots: false });
    const result = await turn("2099-10-20 at 10:00");
    assert.equal(result.state, "collecting");
    assert.match(result.message, /couldn't find another verified/i);
    assert.equal(result.session?.pendingSlotsJson, null);
  });
});

test("availability provider failure is not treated as an unavailable slot", async () => {
  await withAppointmentConversation(async ({ turn, configure }) => {
    await turn("Book an appointment", "start");
    await turn("2");
    configure({ failAvailability: true });
    const result = await turn("2099-10-20 at 10:00");
    assert.equal(result.state, "collecting");
    assert.match(result.message, /couldn't verify appointment availability/i);
    assert.equal(result.session?.pendingSlotsJson, null);
  });
});

test("patient date and time supplied before service selection survive the menu", async () => {
  await withAppointmentConversation(async ({ turn, requests }) => {
    await turn("Book an appointment on 2099-10-20 at 10am", "start");
    assert.equal(requests.filter(request => request.url.includes("free-slots")).length, 0);
    const result = await turn("2");
    assert.equal(result.state, "awaiting_confirmation");
    assert.equal(result.session?.offeringId, "wound");
    assert.equal(result.session?.startAt, "2099-10-20T02:00:00.000Z");
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  });
});

for (const outcome of ["pending", "uncertain", "cancelled"]) {
  test(`patient-led appointment retains ${outcome} creation protections`, async () => {
    await withAppointmentConversation(async ({ turn, requests, configure }) => {
      await turn("Book an appointment", "start");
      await turn("2");
      await turn("2099-10-20 at 10am");
      configure({ status: outcome === "uncertain" ? "confirmed" : outcome, failReadback: outcome === "uncertain" });
      const result = await turn("yes");
      assert.equal(result.state, "awaiting_confirmation");
      assert.equal(JSON.parse(result.session?.dataJson ?? "{}").bookingId, "appointment-test");
      assert.doesNotMatch(result.message, /is confirmed|all booked/i);
      await turn("yes");
      assert.equal(requests.filter(request => request.method === "POST").length, 1);
    });
  });
}

test("ambiguous service and date/time requests clarify without a slot proposal", async () => {
  await withAppointmentConversation(async ({ turn, requests }) => {
    await turn("Book an appointment", "start");
    const ambiguousService = await turn("care or consultation");
    assert.equal(ambiguousService.session?.offeringId, null);
    assert.match(ambiguousService.message, /Which service/i);
    assert.doesNotMatch(ambiguousService.message, /1\.|2\./);
    await turn("2");
    for (const preference of ["next week at 2", "2020-01-01", "2099-02-30 at 10am"]) {
      const result = await turn(preference);
      assert.equal(result.state, "collecting");
      assert.match(result.message, /clarify|future|valid/i);
    }
    assert.equal(requests.filter(request => request.url.includes("free-slots")).length, 0);
  });
});

test("appointment local time uses the configured timezone and rejects DST ambiguity", () => {
  assert.equal(appointmentLocalTimeToISO("2099-10-20", "10:00", "Asia/Kuala_Lumpur"), "2099-10-20T02:00:00.000Z");
  assert.equal(appointmentLocalTimeToISO("2026-07-20", "10:00", "America/New_York"), "2026-07-20T14:00:00.000Z");
  assert.equal(appointmentLocalTimeToISO("2026-03-08", "02:30", "America/New_York"), null);
  assert.equal(appointmentLocalTimeToISO("2026-11-01", "01:30", "America/New_York"), null);
});
