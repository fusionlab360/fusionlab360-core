import test from "node:test";
import assert from "node:assert/strict";
import { verify } from "./ghl-credential-release-preflight.mjs";

function fixture() {
  const bindings = ["DB", "AI", "VECTORIZE", "VECTORIZE_V2", "CF_VERSION_METADATA",
    "GHL_INBOUND_QUEUE", "GHL_OAUTH_CLIENT_ID", "GHL_OAUTH_CLIENT_SECRET",
    "CORS_ALLOWED_ORIGINS", "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS",
    "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION"].map(name => ({ name, type: "fixture" }));
  bindings.push({ name: "REMOTE_ONLY_FLAG", type: "plain_text", text: "false" });
  const baseline = { id: "before", resources: { bindings, script_runtime: {
    compatibility_date: "2025-07-01", compatibility_flags: [],
  } } };
  const candidate = structuredClone(baseline);
  candidate.id = "candidate";
  candidate.resources.bindings.push(
    { name: "CORE_CREDENTIAL_ENCRYPTION_KEYS", type: "secret_text" },
    { name: "CORE_CREDENTIAL_ACTIVE_KEY_VERSION", type: "plain_text", text: "ghl-v1" },
    { name: "CORE_CREDENTIAL_LEGACY_READS_ENABLED", type: "plain_text", text: "true" },
  );
  return [baseline, candidate, { baselineId: "before", candidateId: "candidate",
    keyVersion: "ghl-v1", approvedKeyVersions: ["ghl-v1"], requiredReadVersions: [] }];
}
test("accepts preserved bridge configuration and flags the legacy window", () => {
  assert.deepEqual(verify(...fixture()), { passed: true, failures: [], legacyCompatibilityWindow: true });
});
test("rejects missing key, incorrect label, removed flag and uncovered ciphertext version", () => {
  const [baseline, candidate, manifest] = fixture();
  candidate.resources.bindings = candidate.resources.bindings.filter(
    row => !["REMOTE_ONLY_FLAG", "CORE_CREDENTIAL_ENCRYPTION_KEYS"].includes(row.name));
  candidate.resources.bindings.find(row => row.name.endsWith("ACTIVE_KEY_VERSION") &&
    row.name.startsWith("CORE")).text = "unexpected";
  manifest.requiredReadVersions = ["retired"];
  const result = verify(baseline, candidate, manifest);
  assert.deepEqual(result.failures, ["EXISTING_BINDING_DRIFT", "CORE_KEYRING_BINDING",
    "CORE_ACTIVE_VERSION", "KEY_VERSION_COMPATIBILITY"]);
  assert.doesNotMatch(JSON.stringify(result), /unexpected|retired/);
});
