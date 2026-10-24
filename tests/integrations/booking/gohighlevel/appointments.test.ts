import assert from "node:assert/strict";
import test from "node:test";

import type { IntegrationContext } from "../../../../src/context/integration";
import {
  cancelGHLAppointment,
  createGHLAppointment,
  getGHLAppointment,
  GHLAppointmentNormalizationError,
} from "../../../../src/integrations/booking/gohighlevel/appointments";

const appointment = {
  id: "appointment-1",
  calendarId: "calendar-1",
  locationId: "location-1",
  contactId: "contact-1",
  startTime: "2026-10-20T02:00:00.000Z",
  endTime: "2026-10-20T02:30:00.000Z",
  title: "Test appointment",
  appointmentStatus: "confirmed",
};

function createContext(): IntegrationContext {
  return {
    tenant: {
      id: "tenant-test",
      integrations: {
        crm: {
          provider: "gohighlevel",
          credentials: { locationId: "location-1" },
        },
      },
    },
    provider: "gohighlevel",
    requestId: "request-test",
    receivedAt: new Date("2026-10-17T00:00:00.000Z"),
    integrationRuntime: {
      credentials: {
        async resolve() {
          return { authType: "api_key", accessToken: "test-token" };
        },
      },
    },
  } as unknown as IntegrationContext;
}

async function withMockFetch<T>(
  body: unknown,
  run: (requests: Request[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("GHL create normalizes a root appointment response and request time fallback", async () => {
  await withMockFetch(
    { ...appointment, startTime: undefined, endTime: undefined },
    async (requests) => {
      const result = await createGHLAppointment(createContext(), {
        title: "Test appointment",
        calendarId: appointment.calendarId,
        locationId: appointment.locationId,
        contactId: appointment.contactId,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        appointmentStatus: "confirmed",
      });
      assert.equal(result.id, appointment.id);
      assert.equal(result.startTime, appointment.startTime);
      assert.equal(result.endTime, appointment.endTime);
      assert.equal(requests[0]?.method, "POST");
      assert.match(requests[0]?.url ?? "", /\/calendars\/events\/appointments$/);
    },
  );
});

test("GHL create normalizes the appointment envelope", async () => {
  await withMockFetch({ appointment }, async () => {
    const result = await createGHLAppointment(createContext(), {
      title: "Test appointment",
      calendarId: appointment.calendarId,
      locationId: appointment.locationId,
      contactId: appointment.contactId,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
    });
    assert.equal(result.id, appointment.id);
    assert.equal(result.appointmentStatus, "confirmed");
  });
});

test("GHL get normalizes event and appointment response envelopes", async () => {
  for (const body of [{ event: appointment }, { appointment }]) {
    await withMockFetch(body, async (requests) => {
      const result = await getGHLAppointment(createContext(), appointment.id);
      assert.equal(result.id, appointment.id);
      assert.equal(result.calendarId, appointment.calendarId);
      assert.equal(result.contactId, appointment.contactId);
      assert.equal(result.appointmentStatus, "confirmed");
      assert.equal(requests[0]?.method, "GET");
      assert.match(requests[0]?.url ?? "", /appointments\/appointment-1$/);
    });
  }
});

test("GHL get rejects an unusable response instead of normalizing incomplete identity", async () => {
  await withMockFetch({ event: { id: appointment.id } }, async () => {
    await assert.rejects(
      getGHLAppointment(createContext(), appointment.id),
      /no usable appointment/i,
    );
  });
});

test("GHL cancellation uses the supported mutation and preserves the provider response for readback", async () => {
  await withMockFetch({ appointment: { ...appointment, appointmentStatus: "cancelled" } }, async (requests) => {
    const result = await cancelGHLAppointment(createContext(), appointment.id);
    assert.equal(result.id, appointment.id);
    assert.equal(result.appointmentStatus, "cancelled");
    assert.equal(requests[0]?.method, "PUT");
    assert.match(requests[0]?.url ?? "", /appointments\/appointment-1$/);
    const body = await requests[0]?.clone().json() as Record<string, unknown>;
    assert.equal(body.appointmentStatus, "cancelled");
  });
});

test("GHL normalization failures expose safe envelope and field diagnostics", async () => {
  await withMockFetch({ event: { id: appointment.id, calendarId: appointment.calendarId } }, async () => {
    await assert.rejects(
      getGHLAppointment(createContext(), appointment.id),
      (error: unknown) => {
        assert.ok(error instanceof GHLAppointmentNormalizationError);
        assert.deepEqual(error.diagnostics, {
          envelopeType: "event",
          requiredFields: {
            id: true,
            calendarId: true,
            locationId: false,
            contactId: false,
            startTime: false,
            title: false,
          },
          failureCategory: "missing_required_fields",
        });
        return true;
      },
    );
  });
});
