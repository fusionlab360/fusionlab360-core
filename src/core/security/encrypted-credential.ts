export interface CredentialEncryptionContext {
  tenantId: string;
  integrationId: string;
  connectionId: string;
  provider: string;
}

export interface EncryptedCredentialEnvelope {
  algorithm: "AES-GCM";
  keyVersion: string;
  nonce: string;
  ciphertext: string;
}

export interface CredentialCipherConfiguration {
  keyring: string;
  activeKeyVersion: string;
}

export class CredentialCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCipherError";
  }
}

const NONCE_BYTES = 12;
const AES_256_KEY_BYTES = 32;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function assertIdentifier(value: string, field: string): void {
  if (!value?.trim()) {
    throw new CredentialCipherError(`${field} is required for credential encryption.`);
  }
}

function assertContext(context: CredentialEncryptionContext): void {
  assertIdentifier(context.tenantId, "tenantId");
  assertIdentifier(context.integrationId, "integrationId");
  assertIdentifier(context.connectionId, "connectionId");
  assertIdentifier(context.provider, "provider");
}

function validateKeyVersion(version: string): void {
  if (!KEY_VERSION_PATTERN.test(version)) {
    throw new CredentialCipherError("Credential key version is invalid.");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CredentialCipherError("Credential encryption material is malformed.");
  }

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new CredentialCipherError("Credential encryption material is malformed.");
  }
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function additionalAuthenticatedData(context: CredentialEncryptionContext): ArrayBuffer {
  assertContext(context);
  return asArrayBuffer(new TextEncoder().encode([
    "fusionlab360",
    "credential",
    "v1",
    context.provider,
    context.tenantId,
    context.integrationId,
    context.connectionId,
  ].join("\u001f")));
}

function parseKeyring(value: string): ReadonlyMap<string, Uint8Array> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CredentialCipherError("Credential encryption keyring is malformed.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CredentialCipherError("Credential encryption keyring is malformed.");
  }

  const entries = Object.entries(parsed);
  if (!entries.length) {
    throw new CredentialCipherError("Credential encryption keyring is empty.");
  }

  const keys = new Map<string, Uint8Array>();
  for (const [version, encodedKey] of entries) {
    validateKeyVersion(version);
    if (typeof encodedKey !== "string") {
      throw new CredentialCipherError("Credential encryption keyring is malformed.");
    }
    const key = base64ToBytes(encodedKey);
    if (key.byteLength !== AES_256_KEY_BYTES) {
      throw new CredentialCipherError("Credential encryption key has an unsupported length.");
    }
    keys.set(version, key);
  }
  return keys;
}

export class CredentialCipher {
  private constructor(
    private readonly keys: ReadonlyMap<string, Uint8Array>,
    private readonly activeKeyVersion: string,
  ) {}

  static fromConfiguration(configuration: CredentialCipherConfiguration): CredentialCipher {
    validateKeyVersion(configuration.activeKeyVersion);
    const keys = parseKeyring(configuration.keyring);
    if (!keys.has(configuration.activeKeyVersion)) {
      throw new CredentialCipherError("Active credential encryption key is unavailable.");
    }
    return new CredentialCipher(keys, configuration.activeKeyVersion);
  }

  async encrypt(context: CredentialEncryptionContext, plaintext: string): Promise<EncryptedCredentialEnvelope> {
    assertContext(context);
    if (!plaintext?.trim()) {
      throw new CredentialCipherError("Cannot encrypt an empty credential.");
    }

    const keyMaterial = this.keys.get(this.activeKeyVersion);
    if (!keyMaterial) {
      throw new CredentialCipherError("Active credential encryption key is unavailable.");
    }

    try {
      const key = await crypto.subtle.importKey(
        "raw",
        asArrayBuffer(keyMaterial),
        { name: "AES-GCM" },
        false,
        ["encrypt"],
      );
      const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: asArrayBuffer(nonce),
          additionalData: additionalAuthenticatedData(context),
        },
        key,
        asArrayBuffer(new TextEncoder().encode(plaintext)),
      );
      return {
        algorithm: "AES-GCM",
        keyVersion: this.activeKeyVersion,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      };
    } catch (error) {
      if (error instanceof CredentialCipherError) throw error;
      throw new CredentialCipherError("Credential encryption failed.");
    }
  }

  async decrypt(context: CredentialEncryptionContext, envelope: EncryptedCredentialEnvelope): Promise<string> {
    assertContext(context);
    if (envelope.algorithm !== "AES-GCM") {
      throw new CredentialCipherError("Credential encryption algorithm is unsupported.");
    }
    validateKeyVersion(envelope.keyVersion);

    const keyMaterial = this.keys.get(envelope.keyVersion);
    if (!keyMaterial) {
      throw new CredentialCipherError("Credential encryption key is unavailable.");
    }

    const nonce = base64ToBytes(envelope.nonce);
    if (nonce.byteLength !== NONCE_BYTES) {
      throw new CredentialCipherError("Credential nonce is malformed.");
    }

    try {
      const key = await crypto.subtle.importKey(
        "raw",
        asArrayBuffer(keyMaterial),
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asArrayBuffer(nonce),
          additionalData: additionalAuthenticatedData(context),
        },
        key,
        asArrayBuffer(base64ToBytes(envelope.ciphertext)),
      );
      return new TextDecoder().decode(plaintext);
    } catch (error) {
      if (error instanceof CredentialCipherError) throw error;
      throw new CredentialCipherError("Credential ciphertext could not be authenticated.");
    }
  }
}
