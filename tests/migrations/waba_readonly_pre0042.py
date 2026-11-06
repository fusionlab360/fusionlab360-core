"""Check the read-only status queries against the real pre-0042 D1 schema."""

import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[2]


def query(path: str, method: str) -> str:
    source = (ROOT / path).read_text(encoding="utf-8")
    match = re.search(rf"async {method}\(.*?prepare\(`(.*?)`\)", source, re.S)
    assert match, f"Missing query for {method}"
    return match.group(1)


db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("CREATE TABLE tenants(id TEXT PRIMARY KEY); CREATE TABLE integrations(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, provider TEXT NOT NULL);")
for migration in ("0029_meta_whatsapp_connections.sql", "0030_meta_whatsapp_credential_security.sql"):
    db.executescript((ROOT / "migrations" / migration).read_text(encoding="utf-8"))
columns = {row[1] for row in db.execute("PRAGMA table_info(meta_whatsapp_connections)")}
assert "activation_state" not in columns
db.execute("INSERT INTO tenants VALUES ('tenant_fixture')")
db.execute("INSERT INTO integrations VALUES ('integration_fixture','tenant_fixture','meta_whatsapp')")
db.execute("INSERT INTO meta_whatsapp_connections(id,tenant_id,integration_id,waba_id,phone_number_id,status) VALUES (?,?,?,?,?,?)",
           ("connection_fixture", "tenant_fixture", "integration_fixture", "waba_fixture", "phone_id_fixture", "active"))
db.execute("INSERT INTO meta_whatsapp_credentials(id,tenant_id,integration_id,connection_id,provider,status,ciphertext,nonce,algorithm,key_version,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
           ("credential_fixture", "tenant_fixture", "integration_fixture", "connection_fixture", "meta_whatsapp", "active", "synthetic-ciphertext", "synthetic-nonce", "AES-GCM", "v1", '{"expiresAt":9999999999999}'))
connection_sql = query("src/integrations/messaging/meta-whatsapp/persistence/connection-repository.ts", "findUniqueStatusByTenant")
credential_sql = query("src/integrations/messaging/meta-whatsapp/persistence/credential-repository.ts", "findLifecycleForOwner")
assert db.execute(connection_sql, ("tenant_fixture",)).fetchone() is not None
assert db.execute(connection_sql, ("other_tenant",)).fetchone() is None
assert db.execute(credential_sql, ("tenant_fixture", "integration_fixture", "connection_fixture")).fetchone() is not None
assert db.execute(credential_sql, ("other_tenant", "integration_fixture", "connection_fixture")).fetchone() is None
print("Pre-0042 schema and tenant isolation: PASS")
