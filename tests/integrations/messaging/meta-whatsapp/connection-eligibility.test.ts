import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { isMetaConnectionEligible } from "../../../../src/integrations/messaging/meta-whatsapp/connection-eligibility";

test("pending connections stay ineligible, legacy-active routing is preserved gate-off, and gate-on requires approval", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
    }
    sqlite.exec("INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO integrations(id,tenant_id,provider) VALUES('ia','a','meta_whatsapp'),('ib','b','meta_whatsapp'); INSERT INTO integration_credentials(tenant_id,provider,auth_type,location_id) VALUES('a','gohighlevel','oauth2','loc-a'),('b','gohighlevel','oauth2','loc-b'); INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('ca','a','ia','wa','pa','active'),('cb','b','ib','wb','pb','active'),('pending-a','a','ia','wa','pending-phone','active'); DROP TRIGGER trg_meta_whatsapp_activation_transition; UPDATE meta_whatsapp_connections SET activation_state='legacy_active', activation_actor='migration-fixture', activation_reason='historical verified fixture' WHERE id='ca'");
    const db = { prepare(sql: string) {
      let values: unknown[] = [];
      const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null; } };
      return statement as unknown as D1PreparedStatement;
    } } as D1Database;
    const off = { WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "false" };
    const on = { WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "true" };
    assert.equal(await isMetaConnectionEligible(db, off, "a", "ca"), true);
    assert.equal(await isMetaConnectionEligible(db, on, "a", "ca"), false);
    assert.equal(await isMetaConnectionEligible(db, off, "b", "cb"), false);
    assert.equal(await isMetaConnectionEligible(db, off, "a", "pending-a"), false);
    assert.equal(await isMetaConnectionEligible(db, on, "a", "pending-a"), false);
    sqlite.exec("INSERT INTO meta_whatsapp_legacy_approval_reviews(connection_id,tenant_id,ghl_location_id,ghl_provider_id,reviewer_client_id,evidence_ref) VALUES('pending-a','a','loc-a','provider','reviewer','approval-record')");
    assert.equal(await isMetaConnectionEligible(db, on, "a", "pending-a"), true);
    assert.equal(await isMetaConnectionEligible(db, off, "a", "pending-a"), false);
    assert.equal(await isMetaConnectionEligible(db, on, "b", "pending-a"), false);
    assert.equal(await isMetaConnectionEligible(db, on, "b", "cb"), false);
    sqlite.exec("UPDATE meta_whatsapp_connections SET activation_state='suspended', activation_actor='reviewer', activation_reason='pause' WHERE id='ca'");
    assert.equal(await isMetaConnectionEligible(db, on, "a", "ca"), false);
    assert.equal(await isMetaConnectionEligible(db, off, "a", "ca"), false);
  } finally { sqlite.close(); }
});

test("pre-0042 active connection remains eligible gate-off without querying unavailable lifecycle schema", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      if (file.startsWith("0042_") || file.startsWith("0045_")) continue;
      sqlite.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
    }
    sqlite.exec("INSERT INTO tenants(id,name) VALUES('a','A'); INSERT INTO integrations(id,tenant_id,provider) VALUES('ia','a','meta_whatsapp'); INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('ca','a','ia','wa','pa','active')");
    const db = { prepare(sql: string) {
      let values: unknown[] = [];
      const statement = { bind(...args: unknown[]) { values = args; return statement; }, async first<T>() { return (sqlite.prepare(sql).get(...values as never[]) as T | undefined) ?? null; } };
      return statement as unknown as D1PreparedStatement;
    } } as D1Database;
    assert.equal(await isMetaConnectionEligible(db, { WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "false" }, "a", "ca"), true);
    assert.equal(await isMetaConnectionEligible(db, { WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "true" }, "a", "ca"), false);
  } finally { sqlite.close(); }
});

test("transient lifecycle query failures deny dispatch even while lifecycle enforcement is off", async () => {
  const db = {
    prepare() {
      throw new Error("temporary database connection failure");
    },
  } as unknown as D1Database;
  assert.equal(await isMetaConnectionEligible(db, { WABA_CONNECTION_LIFECYCLE_ENFORCEMENT_ENABLED: "false" }, "tenant", "connection"), false);
});
