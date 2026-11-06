import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { AppBindings, AppVariables } from "../../../../src/config/app";
import { hashApiKey } from "../../../../src/core/security/api-key";
import { createMetaWhatsAppRoutes } from "../../../../src/integrations/messaging/meta-whatsapp/routes";

const keyA = "fl360_review_tenant_a";
const keyB = "fl360_review_tenant_b";
const evidence = "operator-approved-record:review-2026-01";
const endpoint = "/integrations/meta-whatsapp/connections/legacy-reviews";

class TestD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor(private readonly schemaShape: "pre0042" | "original0042" | "revised0042" | "canonical" = "canonical") {
    let seeded = false;
    for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      if (!seeded && file.startsWith("0042_")) {
        this.sqlite.exec("INSERT INTO tenants(id,name) VALUES('tenant-a','A'),('tenant-b','B'); INSERT INTO integrations(id,tenant_id,provider) VALUES('meta-a','tenant-a','meta_whatsapp'),('meta-b','tenant-b','meta_whatsapp'); INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('conn-a','tenant-a','meta-a','waba-a','phone-a','active'),('conn-b','tenant-b','meta-b','waba-b','phone-b','active')");
        seeded = true;
      }
      if (file.startsWith("0042_") && (schemaShape === "pre0042" || schemaShape === "original0042")) {
        if (schemaShape === "original0042") {
          this.sqlite.exec(readFileSync(join(process.cwd(), "tests/fixtures/0042_original_pending.sql"), "utf8"));
        }
        continue;
      }
      if (file.startsWith("0045_") && schemaShape !== "canonical") continue;
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
    }
    if (!seeded) {
      this.sqlite.exec("INSERT INTO tenants(id,name) VALUES('tenant-a','A'),('tenant-b','B'); INSERT INTO integrations(id,tenant_id,provider) VALUES('meta-a','tenant-a','meta_whatsapp'),('meta-b','tenant-b','meta_whatsapp'); INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES('conn-a','tenant-a','meta-a','waba-a','phone-a','active'),('conn-b','tenant-b','meta-b','waba-b','phone-b','active')");
    }
  }
  prepare(sql: string): D1PreparedStatement {
    let args: unknown[] = [];
    const stmt = {
      bind: (...next: unknown[]) => { args = next; return stmt; },
      first: async <T>() => (this.sqlite.prepare(sql).get(...args as never[]) as T | undefined) ?? null,
      all: async <T>() => ({ results: this.sqlite.prepare(sql).all(...args as never[]) as T[] }),
      run: async () => ({ meta: { changes: Number(this.sqlite.prepare(sql).run(...args as never[]).changes) } }),
    };
    return stmt as unknown as D1PreparedStatement;
  }
  async batch(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
  binding() { return this as unknown as D1Database; }
  close() { this.sqlite.close(); }
}

async function setup(schemaShape: "pre0042" | "original0042" | "revised0042" | "canonical" = "canonical") {
  const db = new TestD1(schemaShape);
  if (schemaShape === "canonical") db.sqlite.exec(`
      INSERT INTO integration_credentials(tenant_id,provider,auth_type,location_id) VALUES('tenant-a','gohighlevel','oauth2','loc-a'),('tenant-b','gohighlevel','oauth2','loc-b');
      UPDATE meta_whatsapp_connections SET ghl_location_id='loc-a',ghl_provider_id='provider-a' WHERE id='conn-a';
      UPDATE meta_whatsapp_connections SET ghl_location_id='loc-b',ghl_provider_id='provider-b' WHERE id='conn-b';
    `);
  for (const [id, tenant, token, permissions] of [
    ["client-a", "tenant-a", keyA, ["integrations:write"]],
    ["client-b", "tenant-b", keyB, ["integrations:write"]],
    ["client-read", "tenant-a", "fl360_read_only", ["integrations:read"]],
  ] as const) {
    await db.sqlite.prepare("INSERT INTO clients(id,tenant_id,name,api_key_hash,status,permissions) VALUES(?,?,?,?, 'active', ?)").run(id, tenant, `Client ${id}`, await hashApiKey(token), JSON.stringify(permissions));
  }
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
  app.use("/integrations/*", async (c, next) => {
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) return c.json({ success: false, message: "Unauthorized." }, 401);
    await next();
  });
  app.route("/integrations/meta-whatsapp", createMetaWhatsAppRoutes());
  return { db, request: (token?: string, path = endpoint, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, { DB: db.binding(), WABA_LEGACY_REVIEW_EVIDENCE_ALLOWLIST: evidence } as AppBindings) };
}

test("legacy review endpoints return sanitized SCHEMA_NOT_READY on all pre-0045 schemas after authorization", async () => {
  for (const schemaShape of ["pre0042", "original0042", "revised0042"] as const) {
    const { db, request } = await setup(schemaShape);
    try {
      const before = db.sqlite.prepare("SELECT total_changes() AS changes").get() as { changes: number };
      assert.equal((await request(undefined)).status, 401, `${schemaShape} must authenticate before schema disclosure`);
      assert.equal((await request("fl360_read_only")).status, 403, `${schemaShape} must authorize before schema disclosure`);
      const get = await request(keyA);
      assert.equal(get.status, 503, `${schemaShape} GET`);
      assert.deepEqual(await get.json(), { success: false, code: "SCHEMA_NOT_READY" });
      const post = await request(keyA, endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(post.status, 503, `${schemaShape} POST`);
      assert.deepEqual(await post.json(), { success: false, code: "SCHEMA_NOT_READY" });
      const after = db.sqlite.prepare("SELECT total_changes() AS changes").get() as { changes: number };
      assert.equal(after.changes, before.changes, `${schemaShape} request must not write`);
    } finally { db.close(); }
  }
});

test("legacy review endpoints remain usable on canonical 0042 plus 0045 schema", async () => {
  const { db, request } = await setup("canonical");
  try {
    const response = await request(keyA);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { reviews: unknown[] }).reviews, []);
  } finally { db.close(); }
});

test("legacy review GET authenticates, scopes by tenant, bounds pages, and returns only safe fields", async () => {
  const { db, request } = await setup();
  try {
    db.sqlite.prepare("INSERT INTO meta_whatsapp_legacy_approval_reviews(connection_id,tenant_id,ghl_location_id,ghl_provider_id,reviewer_client_id,evidence_ref) VALUES('conn-a','tenant-a','loc-a','provider-a','client-a',?)").run(evidence);
    db.sqlite.prepare("INSERT INTO meta_whatsapp_legacy_approval_reviews(connection_id,tenant_id,ghl_location_id,ghl_provider_id,reviewer_client_id,evidence_ref) VALUES('conn-b','tenant-b','loc-b','provider-b','client-b',?)").run(evidence);
    db.sqlite.prepare("INSERT INTO meta_whatsapp_connection_activation_audit(tenant_id,connection_id,ghl_location_id,actor_client_id,previous_state,new_state,reason) VALUES('tenant-a','conn-a','loc-a','client-a','legacy_active','legacy_review_approved',?)").run(JSON.stringify({ decision: "approve", evidenceReference: evidence, justification: "synthetic fixture" }));
    db.sqlite.prepare("INSERT INTO meta_whatsapp_connection_activation_audit(tenant_id,connection_id,ghl_location_id,actor_client_id,previous_state,new_state,reason) VALUES('tenant-b','conn-b','loc-b','client-b','legacy_active','legacy_review_approved',?)").run(JSON.stringify({ decision: "approve", evidenceReference: evidence, justification: "synthetic fixture" }));
    assert.equal((await request(undefined)).status, 401);
    assert.equal((await request("fl360_read_only")).status, 403);
    const response = await request(keyA);
    assert.equal(response.status, 200);
    const json = await response.json() as { reviews: Array<Record<string, unknown>> };
    assert.equal(json.reviews.length, 1);
    assert.equal(json.reviews[0]?.connectionId, "conn-a");
    assert.deepEqual(Object.keys(json.reviews[0]!).sort(), ["connectionId", "decision", "decisionState", "evidenceReference", "locationId", "reviewedAt", "reviewerClientId"].sort());
    assert.equal(json.reviews[0]?.decision, "approve");
    assert.equal("justification" in json.reviews[0]!, false);
    assert.equal((await request(keyA, `${endpoint}?limit=101`)).status, 400);
    assert.equal((await request(keyA, `${endpoint}?offset=-1`)).status, 400);
    assert.equal((await request(keyA, `${endpoint}?limit=1&offset=0`)).status, 200);
  } finally { db.close(); }
});

test("legacy review POST requires server-approved evidence, scopes tenant, and records approval/rejection idempotently", async () => {
  const { db, request } = await setup();
  try {
    const post = (token: string, connectionId: string, decision: string, evidenceReference = evidence) => request(token, endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId, decision, evidenceReference, justification: "Operator verified archived onboarding approval record.", operatorId: "forged-client", tenantId: "tenant-b" }) });
    assert.equal((await post(keyA, "conn-b", "approve")).status, 404);
    assert.equal((await post(keyA, "conn-a", "approve", "https://arbitrary.invalid/evidence")).status, 400);
    const approval = await post(keyA, "conn-a", "approve");
    assert.equal(approval.status, 200);
    assert.equal((await post(keyA, "conn-a", "approve")).status, 200);
    assert.equal(db.sqlite.prepare("SELECT reviewer_client_id FROM meta_whatsapp_legacy_approval_reviews WHERE connection_id='conn-a'").get()?.reviewer_client_id, "client-a");
    const rejected = await post(keyB, "conn-b", "reject");
    assert.equal(rejected.status, 200);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM meta_whatsapp_legacy_approval_reviews").get()?.n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM meta_whatsapp_connection_activation_audit WHERE new_state LIKE 'legacy_review_%'").get()?.n, 2);
    const cross = await post(keyA, "conn-a", "reject");
    assert.equal(cross.status, 200);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM meta_whatsapp_connection_activation_audit WHERE connection_id='conn-a' AND new_state='legacy_review_conflict'").get()?.n, 1);
  } finally { db.close(); }
});

test("legacy review POST rejects suspended and revoked connections and ignores caller operator identity", async () => {
  const { db, request } = await setup();
  try {
    db.sqlite.exec("UPDATE meta_whatsapp_connections SET activation_state='suspended', activation_actor='seed-reviewer', activation_reason='seed suspension' WHERE id='conn-a'; UPDATE meta_whatsapp_connections SET activation_state='revoked', activation_actor='seed-reviewer', activation_reason='seed revocation' WHERE id='conn-b'");
    const body = (connectionId: string) => JSON.stringify({ connectionId, decision: "approve", evidenceReference: evidence, justification: "Operator verified archived approval evidence.", operatorId: "forged-client", tenantId: "tenant-b" });
    assert.equal((await request(keyA, endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: body("conn-a") })).status, 409);
    assert.equal((await request(keyB, endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: body("conn-b") })).status, 409);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM meta_whatsapp_legacy_approval_reviews").get()?.n, 0);
  } finally { db.close(); }
});
