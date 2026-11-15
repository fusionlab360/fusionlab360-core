import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

// Run offline. Input snapshots may contain sensitive plain variables; keep them
// in protected storage. Output is limited to fixed check identifiers.
const key = "CORE_CREDENTIAL_ENCRYPTION_KEYS";
const version = "CORE_CREDENTIAL_ACTIVE_KEY_VERSION";
const legacy = "CORE_CREDENTIAL_LEGACY_READS_ENABLED";
const added = new Set([key, version, legacy]);

function requireCheck(ok, code, failures) {
  if (!ok) failures.push(code);
}

export function verify(baseline, candidate, manifest) {
  const failures = [];
  const check = (ok, code) => requireCheck(ok, code, failures);
  const collect = (snapshot) => {
    const rows = snapshot.resources.bindings;
    if (!Array.isArray(rows) || rows.some(row => !row.name || !row.type)) throw new Error();
    const index = new Map(rows.map(row => [row.name, row]));
    if (index.size !== rows.length) throw new Error();
    return index;
  };
  const before = collect(baseline);
  const after = collect(candidate);
  check(baseline.id === manifest.baselineId && candidate.id === manifest.candidateId &&
    baseline.id !== candidate.id && Boolean(baseline.id && candidate.id), "VERSION_ID");
  for (const name of ["DB", "AI", "VECTORIZE", "VECTORIZE_V2", "CF_VERSION_METADATA",
    "GHL_INBOUND_QUEUE", "GHL_OAUTH_CLIENT_ID", "GHL_OAUTH_CLIENT_SECRET",
    "CORS_ALLOWED_ORIGINS", "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS",
    "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION"]) {
    check(before.has(name), "BASELINE_DEPENDENCY");
  }
  // Preserve all effective bindings, including remote-only values and feature gates.
  for (const [name, binding] of before) {
    check(!added.has(name), "UNEXPECTED_BASELINE_CORE_CONFIGURATION");
    check(isDeepStrictEqual(binding, after.get(name)), "EXISTING_BINDING_DRIFT");
  }
  check([...after.keys()].every(name => before.has(name) || added.has(name)), "EXTRA_BINDING");
  check(after.get(key)?.type === "secret_text", "CORE_KEYRING_BINDING");
  check(manifest.keyVersion === "ghl-v1" && after.get(version)?.type === "plain_text" &&
    after.get(version)?.text === manifest.keyVersion, "CORE_ACTIVE_VERSION");
  // Labels must come from a custodian's approved inventory, never key material.
  check(Array.isArray(manifest.approvedKeyVersions) &&
    manifest.approvedKeyVersions.includes(manifest.keyVersion) &&
    Array.isArray(manifest.requiredReadVersions) &&
    manifest.requiredReadVersions.every(label => manifest.approvedKeyVersions.includes(label)),
    "KEY_VERSION_COMPATIBILITY");
  check(after.get(legacy)?.type === "plain_text" && after.get(legacy)?.text === "true",
    "LEGACY_COMPATIBILITY");
  const settings = ["compatibility_date", "compatibility_flags"];
  for (const name of settings) {
    check((name === "compatibility_flags" || typeof baseline.resources.script_runtime?.[name] === "string") &&
      isDeepStrictEqual(baseline.resources.script_runtime?.[name] ?? [], candidate.resources.script_runtime?.[name] ?? []),
      "SCRIPT_SETTINGS");
  }
  check(isDeepStrictEqual(baseline.resources.script?.handlers ?? [], candidate.resources.script?.handlers ?? []), "WORKER_HANDLERS");
  return { passed: failures.length === 0, failures: [...new Set(failures)],
    legacyCompatibilityWindow: after.get(legacy)?.text === "true" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3) throw new Error();
    const result = verify(...args.map(path => JSON.parse(readFileSync(path, "utf8"))));
    console.log(JSON.stringify(result));
    process.exitCode = result.passed ? 0 : 1;
  } catch {
    console.error("INVALID_PREFLIGHT_INPUT");
    process.exitCode = 1;
  }
}
