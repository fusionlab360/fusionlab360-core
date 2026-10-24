import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  CredentialCipher,
  CredentialCipherError,
} from "../../../../src/core/security/encrypted-credential";
import {
  createMetaWhatsAppCredentialVault,
  MetaWhatsAppCredentialError,
} from "../../../../src/integrations/messaging/meta-whatsapp/credential-vault";
import { MetaWhatsAppConnectionRepository } from "../../../../src/integrations/messaging/meta-whatsapp/persistence/connection-repository";

class SQLiteD1 {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const filename of readdirSync(join(process.cwd(), "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      this.sqlite.exec(readFileSync(join(process.cwd(), "migrations", filename), "utf8"));
    }
  }

  prepare(sql: string): D1PreparedStatement {
    let values: unknown[] = [];
    const statement = {
      bind: (...bindings: unknown[]) => {
        values = bindings;
        return statement;
      },
      run: async () => ({
        meta: {
          changes: Number(this.sqlite.prepare(sql).run(...values as never[]).changes),
        },
      }),
      first: async <T>() => (
        this.sqlite.prepare(sql).get(...values as never[]) as T | undefined
      ) ?? null,
      all: async <T>() => ({
        results: this.sqlite.prepare(sql).all(...values as never[]) as T[],
      }),
    };
    return statement as unknown as D1PreparedStatement;
  }

  binding(): D1Database {
    return this as unknown as D1Database;
  }

  close(): void {
    this.sqlite.close();
  }
}

function base64Key(seed: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)));
}

function bindings(seed = 7, activeKeyVersion = "v1") {
  return {
    META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ [activeKeyVersion]: base64Key(seed) }),
    META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION: activeKeyVersion,
  };
}

function owner(overrides: Partial<{
  tenantId: string;
  integrationId: string;
  connectionId: string;
  provider: string;
}> = {}) {
  return {
    tenantId: "tenant-a",
    integrationId: "integration-a",
    connectionId: "connection-a",
    provider: "meta_whatsapp",
    ...overrides,
  };
}

function fixture() {
  const db = new SQLiteD1();
  db.sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A'), ('tenant-b', 'B');
    INSERT INTO integrations (id, tenant_id, provider) VALUES
      ('integration-a', 'tenant-a', 'meta_whatsapp'),
      ('integration-b', 'tenant-b', 'meta_whatsapp'),
      ('integration-ghl', 'tenant-a', 'gohighlevel');
    INSERT INTO meta_whatsapp_connections
      (id, tenant_id, integration_id, waba_id, phone_number_id, status)
      VALUES
      ('connection-a', 'tenant-a', 'integration-a', 'waba-shared', 'phone-a', 'active'),
      ('connection-b', 'tenant-a', 'integration-a', 'waba-shared', 'phone-b', 'pending'),
      ('connection-c', 'tenant-a', 'integration-a', 'waba-shared', 'phone-c', 'disabled');
    INSERT INTO integration_credentials
      (tenant_id, provider, auth_type, api_key, location_id, metadata)
      VALUES ('tenant-a', 'gohighlevel', 'api_key', 'synthetic-ghl-token', 'location-a', '{}');
  `);
  return {
    db,
    vault: createMetaWhatsAppCredentialVault(db.binding(), bindings()),
  };
}

test("AES-GCM credential encryption uses fresh nonces and authenticates the ownership context", async () => {
  const cipher = CredentialCipher.fromConfiguration({
    keyring: JSON.stringify({ v1: base64Key(3) }),
    activeKeyVersion: "v1",
  });
  const context = owner();
  const first = await cipher.encrypt(context, "synthetic-access-token");
  const second = await cipher.encrypt(context, "synthetic-access-token");

  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(await cipher.decrypt(context, first), "synthetic-access-token");
  await assert.rejects(
    cipher.decrypt(owner({ tenantId: "tenant-b" }), first),
    CredentialCipherError,
  );
  await assert.rejects(
    cipher.decrypt(owner({ provider: "gohighlevel" }), first),
    CredentialCipherError,
  );
});

test("Meta credential storage is connection-bound, tenant-scoped, and does not expose tokens in metadata or logs", async () => {
  const { db, vault } = fixture();
  const token = "synthetic-meta-access-token-never-log";
  const logEntries: unknown[][] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => { logEntries.push(values); };
  console.error = (...values: unknown[]) => { logEntries.push(values); };
  try {
    const metadata = await vault.create({
      ...owner(),
      accessToken: token,
      metadata: { scopes: ["whatsapp_business_messaging"], expiresAt: 1_800_000_000_000 },
    });
    assert.equal(metadata.status, "active");
    assert.equal(metadata.credentialVersion, 1);
    assert.doesNotMatch(JSON.stringify(metadata), new RegExp(token));
    assert.equal((await vault.resolve(owner())).accessToken, token);
    assert.equal(logEntries.some((entry) => JSON.stringify(entry).includes(token)), false);

    const stored = db.sqlite.prepare(`
      SELECT ciphertext, nonce, metadata
      FROM meta_whatsapp_credentials
      WHERE connection_id = 'connection-a'
    `).get() as { ciphertext: string; nonce: string; metadata: string };
    assert.notEqual(stored.ciphertext, token);
    assert.notEqual(stored.nonce, token);
    assert.doesNotMatch(stored.metadata, new RegExp(token));

    db.sqlite.prepare(`UPDATE meta_whatsapp_credentials SET metadata = ? WHERE connection_id = ?`)
      .run(JSON.stringify({ accessToken: token }), "connection-a");
    assert.deepEqual((await vault.metadata(owner()))?.metadata, {});
  } finally {
    console.log = originalLog;
    console.error = originalError;
    db.close();
  }
});

test("Meta credential rejects tampered ciphertext, unavailable keys, and non-active connections", async () => {
  const { db, vault } = fixture();
  try {
    await vault.create({ ...owner(), accessToken: "synthetic-token" });
    const wrongKeyVault = createMetaWhatsAppCredentialVault(db.binding(), bindings(8));
    await assert.rejects(wrongKeyVault.resolve(owner()), MetaWhatsAppCredentialError);

    db.sqlite.prepare(`UPDATE meta_whatsapp_credentials SET ciphertext = ? WHERE connection_id = ?`)
      .run(base64Key(9), "connection-a");
    await assert.rejects(vault.resolve(owner()), MetaWhatsAppCredentialError);

    await vault.create({ ...owner({ connectionId: "connection-b" }), accessToken: "pending-token" });
    await assert.rejects(vault.resolve(owner({ connectionId: "connection-b" })), MetaWhatsAppCredentialError);
    await vault.create({ ...owner({ connectionId: "connection-c" }), accessToken: "disabled-token" });
    await assert.rejects(vault.resolve(owner({ connectionId: "connection-c" })), MetaWhatsAppCredentialError);
  } finally {
    db.close();
  }
});

test("Meta credential replacement uses optimistic versions and credential status prevents later use", async () => {
  const { db, vault } = fixture();
  try {
    const created = await vault.create({ ...owner(), accessToken: "first-token", metadata: { scopes: ["scope-a"] } });
    const replaced = await vault.replace({ ...owner(), accessToken: "second-token", expectedVersion: created.credentialVersion });
    assert.equal(replaced.credentialVersion, 2);
    assert.deepEqual(replaced.metadata, { scopes: ["scope-a"] });
    assert.equal((await vault.resolve(owner())).accessToken, "second-token");
    await assert.rejects(
      vault.replace({ ...owner(), accessToken: "stale-token", expectedVersion: created.credentialVersion }),
      MetaWhatsAppCredentialError,
    );

    const disabled = await vault.disable({ ...owner(), expectedVersion: replaced.credentialVersion });
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.credentialVersion, 3);
    await assert.rejects(vault.resolve(owner()), MetaWhatsAppCredentialError);

    const revoked = await vault.revoke({ ...owner(), expectedVersion: disabled.credentialVersion });
    assert.equal(revoked.status, "revoked");
    const stored = db.sqlite.prepare(`SELECT ciphertext, nonce FROM meta_whatsapp_credentials WHERE connection_id = ?`)
      .get("connection-a") as { ciphertext: string | null; nonce: string | null };
    assert.equal(stored.ciphertext, null);
    assert.equal(stored.nonce, null);
    await assert.rejects(vault.resolve(owner()), MetaWhatsAppCredentialError);
  } finally {
    db.close();
  }
});

test("Meta connection and credential ownership cannot cross tenants or providers, while a WABA can have multiple phone numbers", async () => {
  const { db, vault } = fixture();
  try {
    const connections = new MetaWhatsAppConnectionRepository(db.binding());
    assert.equal(await connections.createPending({
      id: "connection-second-phone",
      tenantId: "tenant-a",
      integrationId: "integration-a",
      wabaId: "waba-shared",
      phoneNumberId: "phone-d",
    }), true);
    assert.equal(await connections.findActiveByPhoneNumberId("phone-b"), null);
    assert.equal(await connections.findActiveByPhoneNumberId("phone-c"), null);
    assert.equal(await connections.findActiveByPhoneNumberId("unknown-phone"), null);
    await assert.rejects(
      connections.createPending({
        id: "connection-cross-tenant",
        tenantId: "tenant-b",
        integrationId: "integration-a",
        wabaId: "waba-invalid",
        phoneNumberId: "phone-invalid",
      }),
      /ownership mismatch/,
    );
    await assert.rejects(
      vault.create({ ...owner({ tenantId: "tenant-b" }), accessToken: "cross-tenant-token" }),
      MetaWhatsAppCredentialError,
    );
    await assert.rejects(
      vault.create({ ...owner({ integrationId: "integration-ghl" }), accessToken: "cross-provider-token" }),
      MetaWhatsAppCredentialError,
    );
    await assert.rejects(
      vault.resolve(owner({ provider: "gohighlevel" })),
      MetaWhatsAppCredentialError,
    );

    const ghl = db.sqlite.prepare(`
      SELECT api_key FROM integration_credentials
      WHERE tenant_id = 'tenant-a' AND provider = 'gohighlevel'
    `).get() as { api_key: string };
    assert.equal(ghl.api_key, "synthetic-ghl-token");
  } finally {
    db.close();
  }
});
