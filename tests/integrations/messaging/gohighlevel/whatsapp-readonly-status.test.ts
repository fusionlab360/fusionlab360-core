import assert from "node:assert/strict";
import test from "node:test";
import { readWhatsAppReadonlyStatus } from "../../../../src/integrations/messaging/gohighlevel/whatsapp-readonly-status";

const tenantId = "tenant_fixture";
const locationId = "location_fixture";
const connection = { id: "connection_fixture", integration_id: "meta_integration_fixture", status: "active" };
const credential = (status: string, metadata: Record<string, unknown>, configured = true) => ({ status, configured: configured ? 1 : 0, metadata: JSON.stringify(metadata) });

function fixture(options: {
  connection?: typeof connection | null;
  credential?: ReturnType<typeof credential> | null;
  inbound?: string;
  inboundTenant?: string;
  outbound?: string;
} = {}) {
  const reads: Array<{ sql: string; values: unknown[] }> = [];
  const db = { prepare(sql: string) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
    assert.doesNotMatch(sql, /SELECT\s+(?:credential\.)?(?:ciphertext|nonce|access_token|api_key|refresh_token)|SELECT\s+credential\.\*/i);
    return { bind(...values: unknown[]) {
      reads.push({ sql, values });
      return {
        all: async () => {
          assert.match(sql, /FROM meta_whatsapp_connections connection/);
          assert.deepEqual(values, [tenantId]);
          return { results: options.connection === undefined ? [connection] : options.connection ? [options.connection] : [] };
        },
        first: async () => {
          assert.match(sql, /FROM meta_whatsapp_credentials credential/);
          assert.match(sql, /SELECT credential\.status,/);
          assert.deepEqual(values, [tenantId, connection.integration_id, connection.id]);
          return options.credential === undefined
            ? credential("active", { expiresAt: Date.now() + 86400000 * 30 })
            : options.credential;
        },
      };
    } };
  } };
  return {
    env: {
      DB: db,
      META_WHATSAPP_GHL_INBOUND_ENABLED: options.inbound ?? "true",
      META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST: options.inboundTenant ?? tenantId,
      GHL_META_WHATSAPP_OUTBOUND_ENABLED: options.outbound ?? "false",
      GHL_CUSTOM_PROVIDER_ENABLED: "true",
      GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST: locationId,
    } as never,
    reads,
  };
}

test("read-only status uses tenant-scoped projections and explicitly labels metadata evidence", async () => {
  const { env, reads } = fixture();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; throw new Error("provider call is forbidden"); }) as typeof fetch;
  let result: Awaited<ReturnType<typeof readWhatsAppReadonlyStatus>>;
  try { result = await readWhatsAppReadonlyStatus(env, tenantId, locationId, true); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(result.connectionRecord, "Present");
  assert.equal(result.connectionState, "active (stored)");
  assert.equal(result.credentialRecord, "Present");
  assert.equal(result.credentialState, "active (stored)");
  assert.equal(result.credentialConfigured, "Yes");
  assert.equal(result.credentialExpiryMetadata, "Expiry metadata appears current; token not tested");
  assert.equal(result.providerConfiguration, "Configured in stored settings");
  assert.equal(result.providerGlobal, "Enabled");
  assert.equal(result.providerLocationGate, "Allowed");
  assert.equal(result.providerOperationalVerification, "Not verified");
  assert.equal(result.deliveryOperationalVerification, "Not verified");
  assert.equal(result.inboundGlobal, "Enabled");
  assert.equal(result.inboundTenantGate, "Allowed");
  assert.equal(result.inboundAvailability, "Not operationally verified");
  assert.equal(result.outboundGlobal, "Disabled");
  assert.equal(result.outboundAvailability, "Disabled");
  assert.equal(result.lastVerified, "Not available");
  assert.equal(reads.length, 2);
  assert.equal(providerCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /ciphertext|nonce|access_token|refresh_token|token_fixture|waba_fixture|phone_id_fixture/);
});

test("missing connection stops before credential lookup and disables effective availability", async () => {
  const { env, reads } = fixture({ connection: null });
  const result = await readWhatsAppReadonlyStatus(env, tenantId, locationId, false);
  assert.equal(result.connectionRecord, "Not available");
  assert.equal(result.connectionState, "Not available");
  assert.equal(result.credentialRecord, "Not available");
  assert.equal(result.providerConfiguration, "Not configured");
  assert.equal(result.inboundAvailability, "Unavailable");
  assert.equal(result.outboundAvailability, "Disabled");
  assert.equal(reads.length, 1);
});

test("expired, disabled and malformed credential metadata never claims readiness", async () => {
  const expired = fixture({ credential: credential("active", { expiresAt: Date.now() - 1000 }) });
  const expiredResult = await readWhatsAppReadonlyStatus(expired.env, tenantId, locationId, true);
  assert.equal(expiredResult.credentialExpiryMetadata, "Expiry metadata is expired");
  assert.equal(expiredResult.inboundAvailability, "Unavailable");
  const disabled = fixture({ credential: credential("disabled", { expiresAt: Date.now() + 86400000 }) });
  const disabledResult = await readWhatsAppReadonlyStatus(disabled.env, tenantId, locationId, true);
  assert.equal(disabledResult.credentialState, "disabled (stored)");
  assert.equal(disabledResult.credentialExpiryMetadata, "Not verified");
  const missingMaterial = fixture({ credential: credential("active", { expiresAt: Date.now() + 86400000 }, false) });
  const missingMaterialResult = await readWhatsAppReadonlyStatus(missingMaterial.env, tenantId, locationId, true);
  assert.equal(missingMaterialResult.credentialConfigured, "No");
  assert.equal(missingMaterialResult.credentialExpiryMetadata, "Not verified");
  const malformed = fixture({ credential: { status: "active", configured: 1, metadata: "not-json" } });
  assert.equal((await readWhatsAppReadonlyStatus(malformed.env, tenantId, locationId, true)).credentialExpiryMetadata, "Not verified");
});

test("global and tenant inbound gates are reported separately", async () => {
  const wrongTenantGate = fixture({ inboundTenant: "other_tenant" });
  const wrongTenantResult = await readWhatsAppReadonlyStatus(wrongTenantGate.env, tenantId, locationId, true);
  assert.equal(wrongTenantResult.inboundGlobal, "Enabled");
  assert.equal(wrongTenantResult.inboundTenantGate, "Not allowed");
  assert.equal(wrongTenantResult.inboundAvailability, "Disabled");
  const globallyOff = fixture({ inbound: "false" });
  const globalResult = await readWhatsAppReadonlyStatus(globallyOff.env, tenantId, locationId, true);
  assert.equal(globalResult.inboundTenantGate, "Allowed");
  assert.equal(globalResult.inboundAvailability, "Disabled");
});

test("active global outbound flag remains unverified because recipient/window runtime gates are not evaluated", async () => {
  const { env } = fixture({ outbound: "true" });
  const result = await readWhatsAppReadonlyStatus(env, tenantId, locationId, true);
  assert.equal(result.outboundGlobal, "Enabled");
  assert.equal(result.outboundAvailability, "Not verified; runtime recipient and service-window gates are not evaluated here");
  assert.equal(result.deliveryOperationalVerification, "Not verified");
});
