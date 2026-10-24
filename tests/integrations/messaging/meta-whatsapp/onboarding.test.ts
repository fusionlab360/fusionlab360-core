import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { MetaWhatsAppOnboardingService, MetaWhatsAppOnboardingError, type MetaWhatsAppOnboardingProvider } from "../../../../src/integrations/messaging/meta-whatsapp/onboarding";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() { for (const name of readdirSync(join(process.cwd(), "migrations")).filter((n) => n.endsWith(".sql")).sort()) this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", name), "utf8")); }
  prepare(sql: string): D1PreparedStatement { let values: unknown[] = []; const statement = { bind: (...next: unknown[]) => { values = next; return statement; }, run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes) } }), first: async <T>() => (this.sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null, all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...values as never[]) as T[] }) }; return statement as unknown as D1PreparedStatement; }
  binding(): D1Database { return this as unknown as D1Database; }
  close(): void { this.sqlite.close(); }
}
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const bindings = { META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ v1: key }), META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION: "v1" };
function provider(overrides: Partial<MetaWhatsAppOnboardingProvider> = {}): MetaWhatsAppOnboardingProvider { return {
  exchangeAuthorizationCode: async () => ({ accessToken: "synthetic-secret-token", scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] }),
  verifyWabaAccess: async () => true, listPhoneNumbers: async () => ["phone-a"], verifyWebhookSubscription: async () => true, ...overrides,
}; }
function fixture() { const db = new SQLiteD1(); db.sqlite.exec("INSERT INTO tenants (id,name) VALUES ('tenant-a','A'),('tenant-b','B'); INSERT INTO integrations (id,tenant_id,provider) VALUES ('meta-a','tenant-a','meta_whatsapp'),('meta-b','tenant-b','meta_whatsapp');"); return db; }
async function started(db: SQLiteD1, p = provider()) { const service = new MetaWhatsAppOnboardingService(db.binding(), bindings, p); return { service, start: await service.start({ tenantId: "tenant-a", operatorId: "client-a", integrationId: "meta-a" }) }; }

test("Meta onboarding consumes a tenant and operator-bound state only once, verifies provider ownership, and activates encrypted credentials", async () => {
  const db = fixture(); try {
    const { service, start } = await started(db);
    const complete = await service.complete({ tenantId: "tenant-a", operatorId: "client-a", state: start.state, code: "synthetic-code", wabaId: "waba-a", phoneNumberId: "phone-a" });
    assert.equal(complete.status, "active");
    assert.equal(db.sqlite.prepare("SELECT status FROM meta_whatsapp_connections WHERE id = ?").get(complete.connectionId)?.status, "active");
    const stored = db.sqlite.prepare("SELECT ciphertext FROM meta_whatsapp_credentials WHERE connection_id = ?").get(complete.connectionId) as { ciphertext: string };
    assert.notEqual(stored.ciphertext, "synthetic-secret-token");
    await assert.rejects(service.complete({ tenantId: "tenant-a", operatorId: "client-a", state: start.state, code: "synthetic-code", wabaId: "waba-a", phoneNumberId: "phone-a" }), MetaWhatsAppOnboardingError);
  } finally { db.close(); }
});

test("Meta onboarding rejects cross-tenant/operator callbacks and every unverified provider assertion", async () => {
  const cases: Array<Partial<MetaWhatsAppOnboardingProvider>> = [
    { exchangeAuthorizationCode: async () => ({ accessToken: "token", scopes: ["whatsapp_business_messaging"] }) },
    { verifyWabaAccess: async () => false }, { listPhoneNumbers: async () => ["another-phone"] }, { verifyWebhookSubscription: async () => false },
  ];
  for (const override of cases) { const db = fixture(); try { const { service, start } = await started(db, provider(override)); await assert.rejects(service.complete({ tenantId: "tenant-a", operatorId: "client-a", state: start.state, code: "code", wabaId: "waba-a", phoneNumberId: "phone-a" }), MetaWhatsAppOnboardingError); assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM meta_whatsapp_connections").get()?.count, 0); } finally { db.close(); } }
  const db = fixture(); try { const { service, start } = await started(db); await assert.rejects(service.complete({ tenantId: "tenant-b", operatorId: "client-a", state: start.state, code: "code", wabaId: "waba-a", phoneNumberId: "phone-a" }), MetaWhatsAppOnboardingError); } finally { db.close(); }
});

test("Meta onboarding rejects a phone number already owned by another tenant without leaking the credential", async () => {
  const db = fixture(); try {
    db.sqlite.exec("INSERT INTO meta_whatsapp_connections (id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES ('other','tenant-b','meta-b','waba-b','phone-a','active')");
    const { service, start } = await started(db);
    await assert.rejects(service.complete({ tenantId: "tenant-a", operatorId: "client-a", state: start.state, code: "code", wabaId: "waba-a", phoneNumberId: "phone-a" }), MetaWhatsAppOnboardingError);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM meta_whatsapp_credentials").get()?.count, 0);
  } finally { db.close(); }
});

test("Meta reauthorization replaces an encrypted credential after explicit disablement without creating another connection", async () => {
  const db = fixture(); try {
    const { service, start } = await started(db);
    const first = await service.complete({ tenantId: "tenant-a", operatorId: "client-a", state: start.state, code: "code", wabaId: "waba-a", phoneNumberId: "phone-a" });
    await service.disable({ tenantId: "tenant-a", integrationId: "meta-a", connectionId: first.connectionId, expectedCredentialVersion: first.credentialVersion });
    assert.equal(db.sqlite.prepare("SELECT status FROM meta_whatsapp_connections WHERE id = ?").get(first.connectionId)?.status, "disabled");
    const next = await service.start({ tenantId: "tenant-a", operatorId: "client-a", integrationId: "meta-a" });
    const second = await service.complete({ tenantId: "tenant-a", operatorId: "client-a", state: next.state, code: "code", wabaId: "waba-a", phoneNumberId: "phone-a" });
    assert.equal(second.connectionId, first.connectionId);
    assert.ok(second.credentialVersion > first.credentialVersion);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM meta_whatsapp_connections").get()?.count, 1);
  } finally { db.close(); }
});
