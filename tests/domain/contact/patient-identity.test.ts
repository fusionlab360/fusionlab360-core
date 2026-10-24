import assert from "node:assert/strict";
import test from "node:test";

import { createPatientIdentityGateway } from "../../../src/domain/contact/patient-identity";
import { normalizeInternationalPhoneNumber, normalizePhoneNumber } from "../../../src/core/crm/phone";

function createContext(mappings = true) {
  return {
    tenant: {
      id: "tenant-a",
      integrations: {
        crm: {
          provider: "gohighlevel",
          credentials: { locationId: "location-a" },
          configuration: {
            attributeMappings: mappings
              ? [
                  { canonicalKey: "contact.identityNumber", providerFieldId: "field-identity" },
                  { canonicalKey: "contact.identityType", providerFieldId: "field-type" },
                ]
              : [],
          },
        },
      },
    },
    provider: "gohighlevel",
    requestId: "identity-test",
    receivedAt: new Date("2026-10-18T00:00:00Z"),
    integrationRuntime: {
      credentials: {
        async resolve() {
          return { authType: "api_key", accessToken: "synthetic-token" };
        },
      },
    },
  } as never;
}

async function withResponses(
  responses: unknown[],
  run: (requests: Request[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  let index = 0;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(responses[index++]);
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function contact(id: string, firstName: string, lastName: string, identity?: string, phone?: string) {
  return {
    id,
    firstName,
    lastName,
    phone,
    customFields: identity
      ? [{ id: "field-identity", value: identity }, { id: "field-type", value: "passport" }]
      : [],
  };
}

test("identity gateway accepts a complete tenant-scoped contact without updating it", async () => {
  await withResponses([{ contact: contact("contact-a", "Ada", "Patient", "P1234567") }], async (requests) => {
    const identity = await createPatientIdentityGateway(createContext()).load("contact-a");
    assert.deepEqual(identity, { fullName: "Ada Patient", identityNumber: "P1234567", phone: null, identityType: "passport" });
    assert.equal(requests.length, 1);
    assert.match(requests[0]?.url ?? "", /contacts\/contact-a$/);
  });
});

test("identity gateway normalizes an international phone and verifies a phone update", async () => {
  await withResponses([
    { contact: contact("contact-a", "Guest", "", undefined) },
    { contact: contact("contact-a", "Ada", "Patient", "P1234567", "+60 12-345 6789") },
    { contact: contact("contact-a", "Ada", "Patient", "P1234567", "+60 12-345 6789") },
  ], async (requests) => {
    const identity = await createPatientIdentityGateway(createContext()).update("contact-a", {
      fullName: "Ada Patient",
      identityNumber: "P1234567",
      phone: "0060 12-345 6789",
      identityType: "passport",
    });
    assert.equal(identity.phone, "+60123456789");
    assert.equal(requests[1]?.method, "PUT");
    const payload = await requests[1]?.clone().json() as Record<string, unknown>;
    assert.equal(payload.phone, "+60123456789");
  });
});

test("phone normalization accepts explicit Malaysian international forms without assuming a country", () => {
  assert.equal(normalizePhoneNumber("+60 12-345 6789"), "+60123456789");
  assert.equal(normalizePhoneNumber("0060 (12) 345 6789"), "+60123456789");
  assert.equal(normalizePhoneNumber("012-345 6789"), "0123456789");
  assert.equal(normalizePhoneNumber("123"), null);
  assert.equal(normalizeInternationalPhoneNumber("+60 12-345 6789"), "+60123456789");
  assert.equal(normalizeInternationalPhoneNumber("+65 8123 4567"), "+6581234567");
  assert.equal(normalizeInternationalPhoneNumber("+91 98765 43210"), "+919876543210");
  assert.equal(normalizeInternationalPhoneNumber("0060 12-345 6789"), "+60123456789");
  assert.equal(normalizeInternationalPhoneNumber("012-345 6789"), null);
  assert.equal(normalizeInternationalPhoneNumber("+60 123"), null);
});

test("identity gateway updates an existing guest and verifies it with a fresh GET", async () => {
  await withResponses([
    { contact: contact("contact-a", "Guest", "") },
    { contact: contact("contact-a", "Ada", "Patient", "P1234567") },
    { contact: contact("contact-a", "Ada", "Patient", "P1234567") },
  ], async (requests) => {
    const identity = await createPatientIdentityGateway(createContext()).update("contact-a", {
      fullName: "Ada Patient",
      identityNumber: "P1234567",
      phone: null,
      identityType: "passport",
    });
    assert.equal(identity.identityNumber, "P1234567");
    assert.equal(requests[0]?.method, "GET");
    assert.equal(requests[1]?.method, "PUT");
    assert.equal(requests[2]?.method, "GET");
  });
});

test("identity gateway fails closed when mappings are missing or the refreshed contact belongs elsewhere", async () => {
  await withResponses([
    { contact: contact("contact-a", "Guest", "") },
    { contact: contact("contact-a", "Ada", "Patient") },
    { contact: contact("contact-a", "Ada", "Patient") },
  ], async () => {
    await assert.rejects(
      createPatientIdentityGateway(createContext(false)).update("contact-a", {
        fullName: "Ada Patient",
        identityNumber: "P1234567",
        phone: null,
        identityType: "passport",
      }),
      /could not be verified|readback/i,
    );
  });

  await withResponses([{ contact: contact("contact-other", "Ada", "Patient", "P1234567") }], async () => {
    await assert.rejects(
      createPatientIdentityGateway(createContext()).load("contact-a"),
      /linked customer|contact/i,
    );
  });
});
