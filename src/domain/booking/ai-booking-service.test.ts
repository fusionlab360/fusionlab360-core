import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

import type { AIProvider } from "../../core/ai";
import type { IntegrationContext } from "../../context/integration";

import {
  setTenantFeatureEnabled,
} from "../features/tenant-feature-service";

import {
  processAIBooking,
  type ProcessAIBookingInput,
} from "./ai-booking-service";

import type {
  BookingIntent,
} from "./booking-intent";

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