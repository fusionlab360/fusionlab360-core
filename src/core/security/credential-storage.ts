import {
  CredentialCipher,
  CredentialCipherError,
  type CredentialEncryptionContext,
  type EncryptedCredentialEnvelope,
} from "./encrypted-credential";

export interface CredentialKeyBindings {
  CORE_CREDENTIAL_ENCRYPTION_KEYS?: string;
  CORE_CREDENTIAL_ACTIVE_KEY_VERSION?: string;
  /** Enable temporary reads of legacy plaintext GHL credentials during rollout. */
  CORE_CREDENTIAL_LEGACY_READS_ENABLED?: string;
}

export interface CredentialStorageConfiguration {
  cipher?: CredentialCipher;
  allowLegacyPlaintextReads: boolean;
}

const ENVELOPE_PREFIX = "fl360enc:v1:";

export function createCredentialCipher(bindings: CredentialKeyBindings): CredentialCipher {
  const keyring = bindings.CORE_CREDENTIAL_ENCRYPTION_KEYS?.trim();
  const activeKeyVersion = bindings.CORE_CREDENTIAL_ACTIVE_KEY_VERSION?.trim();
  if (!keyring || !activeKeyVersion) {
    throw new CredentialCipherError("Core credential encryption is not configured.");
  }
  return CredentialCipher.fromConfiguration({ keyring, activeKeyVersion });
}

export function createCredentialCipherIfConfigured(bindings: CredentialKeyBindings): CredentialCipher | undefined {
  const keyring = bindings.CORE_CREDENTIAL_ENCRYPTION_KEYS?.trim();
  const activeKeyVersion = bindings.CORE_CREDENTIAL_ACTIVE_KEY_VERSION?.trim();
  if (!keyring && !activeKeyVersion) return undefined;
  if (!keyring || !activeKeyVersion) {
    throw new CredentialCipherError("Core credential encryption configuration is incomplete.");
  }
  return CredentialCipher.fromConfiguration({ keyring, activeKeyVersion });
}

export function createCredentialStorageConfiguration(
  bindings: CredentialKeyBindings,
): CredentialStorageConfiguration {
  return {
    cipher: createCredentialCipherIfConfigured(bindings),
    allowLegacyPlaintextReads: bindings.CORE_CREDENTIAL_LEGACY_READS_ENABLED === "true",
  };
}

export function isEncryptedCredential(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("fl360enc:");
}

export async function encryptCredentialValue(
  cipher: CredentialCipher,
  context: CredentialEncryptionContext,
  plaintext: string | null | undefined,
): Promise<string | null> {
  if (plaintext == null || plaintext === "") return plaintext ?? null;
  return serializeEnvelope(await cipher.encrypt(context, plaintext));
}

export async function decryptCredentialValue(
  cipher: CredentialCipher | undefined,
  context: CredentialEncryptionContext,
  storedValue: string | null | undefined,
  allowLegacyPlaintextReads = false,
): Promise<string | null> {
  if (storedValue == null || storedValue === "") return storedValue ?? null;
  if (!isEncryptedCredential(storedValue)) {
    if (!allowLegacyPlaintextReads) {
      throw new CredentialCipherError("Legacy plaintext credential reads are disabled.", "CREDENTIAL_LEGACY_READ_DISABLED");
    }
    return storedValue;
  }
  if (!storedValue.startsWith(ENVELOPE_PREFIX)) {
    throw new CredentialCipherError("Stored credential envelope version is unsupported.");
  }
  if (!cipher) {
    throw new CredentialCipherError("Credential encryption keys are required to read this credential.", "CREDENTIAL_KEYRING_MISSING");
  }
  return cipher.decrypt(context, parseEnvelope(storedValue));
}

function serializeEnvelope(envelope: EncryptedCredentialEnvelope): string {
  return `${ENVELOPE_PREFIX}${envelope.keyVersion}:${envelope.nonce}:${envelope.ciphertext}`;
}

function parseEnvelope(value: string): EncryptedCredentialEnvelope {
  const fields = value.slice(ENVELOPE_PREFIX.length).split(":");
  if (fields.length !== 3 || fields.some((field) => !field)) {
    throw new CredentialCipherError("Stored credential envelope is malformed.");
  }
  return {
    algorithm: "AES-GCM",
    keyVersion: fields[0],
    nonce: fields[1],
    ciphertext: fields[2],
  };
}

export function integrationCredentialContext(
  tenantId: string,
  provider: string,
  locationId: string | null | undefined,
  field: "access" | "refresh",
): CredentialEncryptionContext {
  const normalizedLocationId = locationId?.trim();
  return {
    tenantId,
    integrationId: provider,
    connectionId: `${normalizedLocationId || "unbound"}:${field}`,
    provider,
  };
}

/**
 * Shared company installations are keyed by provider/account in the existing
 * schema, so their company ID is the cryptographic owner scope. Location
 * credentials use integrationCredentialContext and include the actual tenant.
 */
export function oauthInstallationCredentialContext(
  provider: string,
  accountType: string,
  externalAccountId: string,
  field: "access" | "refresh",
): CredentialEncryptionContext {
  const normalizedAccountId = externalAccountId.trim();
  const accountScope = `${accountType}:${normalizedAccountId}`;
  return {
    tenantId: `oauth-account:${accountScope}`,
    integrationId: `${provider}:${accountType}`,
    connectionId: `${accountScope}:${field}`,
    provider,
  };
}
