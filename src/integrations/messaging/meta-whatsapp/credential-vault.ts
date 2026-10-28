import {
  CredentialCipher,
  CredentialCipherError,
  type CredentialEncryptionContext,
} from "../../../core/security/encrypted-credential";
import type { AppBindings } from "../../../config/app";
import type { MetaWhatsAppCredentialMetadata } from "./persistence/credential-model";
import {
  MetaWhatsAppCredentialRepository,
  type MetaWhatsAppCredentialOwner,
} from "./persistence/credential-repository";

const META_WHATSAPP_PROVIDER = "meta_whatsapp";

export interface MetaWhatsAppCredentialMetadataInput {
  expiresAt?: number;
  scopes?: readonly string[];
  developerTest?: boolean;
}

export interface MetaWhatsAppCredentialRequest extends MetaWhatsAppCredentialOwner {
  provider: string;
}

export interface StoreMetaWhatsAppCredentialInput extends MetaWhatsAppCredentialRequest {
  accessToken: string;
  metadata?: MetaWhatsAppCredentialMetadataInput;
}

export interface ReplaceMetaWhatsAppCredentialInput extends StoreMetaWhatsAppCredentialInput {
  expectedVersion: number;
}

export interface ResolvedMetaWhatsAppCredential {
  accessToken: string;
  credentialVersion: number;
  metadata: MetaWhatsAppCredentialMetadata;
}

export class MetaWhatsAppCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaWhatsAppCredentialError";
  }
}

function assertOwner(owner: MetaWhatsAppCredentialOwner): void {
  if (!owner.tenantId?.trim() || !owner.integrationId?.trim() || !owner.connectionId?.trim()) {
    throw new MetaWhatsAppCredentialError("A tenant, integration, and connection are required.");
  }
}

function assertProvider(provider: string): void {
  if (provider !== META_WHATSAPP_PROVIDER) {
    throw new MetaWhatsAppCredentialError("Credential provider is not authorized for Meta WhatsApp.");
  }
}

function contextFor(request: MetaWhatsAppCredentialRequest): CredentialEncryptionContext {
  assertOwner(request);
  assertProvider(request.provider);
  return {
    tenantId: request.tenantId,
    integrationId: request.integrationId,
    connectionId: request.connectionId,
    provider: META_WHATSAPP_PROVIDER,
  };
}

function normalizeMetadata(input: MetaWhatsAppCredentialMetadataInput | undefined): Record<string, unknown> {
  if (!input) return {};
  const metadata: Record<string, unknown> = {};
  if (input.expiresAt !== undefined) {
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
      throw new MetaWhatsAppCredentialError("Credential expiration metadata is invalid.");
    }
    metadata.expiresAt = input.expiresAt;
  }
  if (input.scopes !== undefined) {
    if (!Array.isArray(input.scopes) || input.scopes.some((scope) => !scope?.trim())) {
      throw new MetaWhatsAppCredentialError("Credential scope metadata is invalid.");
    }
    metadata.scopes = [...new Set(input.scopes.map((scope) => scope.trim()))];
  }
  if (input.developerTest !== undefined) {
    if (input.developerTest !== true) {
      throw new MetaWhatsAppCredentialError("Developer test credential metadata is invalid.");
    }
    metadata.developerTest = true;
  }
  return metadata;
}

function safeMetadata(record: {
  id: string;
  tenantId: string;
  integrationId: string;
  connectionId: string;
  provider: "meta_whatsapp";
  status: MetaWhatsAppCredentialMetadata["status"];
  keyVersion: string;
  credentialVersion: number;
  metadata: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}): MetaWhatsAppCredentialMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.metadata);
  } catch {
    throw new MetaWhatsAppCredentialError("Credential metadata is malformed.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MetaWhatsAppCredentialError("Credential metadata is malformed.");
  }

  const candidate = parsed as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  if (candidate.expiresAt !== undefined) {
    if (typeof candidate.expiresAt !== "number" || !Number.isSafeInteger(candidate.expiresAt) || candidate.expiresAt <= 0) {
      throw new MetaWhatsAppCredentialError("Credential metadata is malformed.");
    }
    metadata.expiresAt = candidate.expiresAt;
  }
  if (candidate.scopes !== undefined) {
    if (!Array.isArray(candidate.scopes) || candidate.scopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
      throw new MetaWhatsAppCredentialError("Credential metadata is malformed.");
    }
    metadata.scopes = [...new Set(candidate.scopes.map((scope) => scope.trim()))];
  }
  if (candidate.developerTest !== undefined) {
    if (candidate.developerTest !== true) {
      throw new MetaWhatsAppCredentialError("Credential metadata is malformed.");
    }
    metadata.developerTest = true;
  }

  return {
    id: record.id,
    tenantId: record.tenantId,
    integrationId: record.integrationId,
    connectionId: record.connectionId,
    provider: record.provider,
    status: record.status,
    keyVersion: record.keyVersion,
    credentialVersion: record.credentialVersion,
    metadata,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class MetaWhatsAppCredentialVault {
  constructor(
    private readonly repository: MetaWhatsAppCredentialRepository,
    private readonly cipher: CredentialCipher,
  ) {}

  async create(input: StoreMetaWhatsAppCredentialInput): Promise<MetaWhatsAppCredentialMetadata> {
    const context = contextFor(input);
    if (!input.accessToken?.trim()) {
      throw new MetaWhatsAppCredentialError("A non-empty Meta WhatsApp credential is required.");
    }
    const metadata = JSON.stringify(normalizeMetadata(input.metadata));
    const encrypted = await this.cipher.encrypt(context, input.accessToken.trim());
    const stored = await this.repository.create({
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      connectionId: input.connectionId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      algorithm: encrypted.algorithm,
      keyVersion: encrypted.keyVersion,
      metadata,
    });
    if (!stored) {
      throw new MetaWhatsAppCredentialError("Meta WhatsApp credential could not be created for this connection.");
    }
    const record = await this.repository.findForOwner(input);
    if (!record) throw new MetaWhatsAppCredentialError("Meta WhatsApp credential could not be read after storage.");
    return safeMetadata(record);
  }

  async replace(input: ReplaceMetaWhatsAppCredentialInput): Promise<MetaWhatsAppCredentialMetadata> {
    const context = contextFor(input);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new MetaWhatsAppCredentialError("Credential version is invalid.");
    }
    if (!input.accessToken?.trim()) {
      throw new MetaWhatsAppCredentialError("A non-empty Meta WhatsApp credential is required.");
    }
    const existing = await this.repository.findForOwner(input);
    if (!existing) {
      throw new MetaWhatsAppCredentialError("No Meta WhatsApp credential is available for this connection.");
    }
    const encrypted = await this.cipher.encrypt(context, input.accessToken.trim());
    const replaced = await this.repository.replace({
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      connectionId: input.connectionId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      algorithm: encrypted.algorithm,
      keyVersion: encrypted.keyVersion,
      metadata: input.metadata === undefined
        ? existing.metadata
        : JSON.stringify(normalizeMetadata(input.metadata)),
      expectedVersion: input.expectedVersion,
    });
    if (!replaced) {
      throw new MetaWhatsAppCredentialError("Meta WhatsApp credential replacement was rejected due to a stale or inactive credential.");
    }
    const record = await this.repository.findForOwner(input);
    if (!record) throw new MetaWhatsAppCredentialError("Meta WhatsApp credential could not be read after replacement.");
    return safeMetadata(record);
  }

  async resolve(request: MetaWhatsAppCredentialRequest): Promise<ResolvedMetaWhatsAppCredential> {
    const context = contextFor(request);
    const record = await this.repository.findActiveForOwner(request);
    if (!record || !record.ciphertext || !record.nonce) {
      throw new MetaWhatsAppCredentialError("No active Meta WhatsApp credential is available for this connection.");
    }
    const metadata = safeMetadata(record);
    if (
      metadata.metadata.developerTest === true &&
      (typeof metadata.metadata.expiresAt !== "number" || metadata.metadata.expiresAt <= Date.now())
    ) {
      throw new MetaWhatsAppCredentialError("Meta developer test credential has expired.");
    }
    try {
      const accessToken = await this.cipher.decrypt(context, {
        algorithm: record.algorithm,
        keyVersion: record.keyVersion,
        nonce: record.nonce,
        ciphertext: record.ciphertext,
      });
      return {
        accessToken,
        credentialVersion: record.credentialVersion,
        metadata,
      };
    } catch (error) {
      if (error instanceof CredentialCipherError) {
        throw new MetaWhatsAppCredentialError("Meta WhatsApp credential could not be authenticated.");
      }
      throw error;
    }
  }

  async metadata(request: MetaWhatsAppCredentialRequest): Promise<MetaWhatsAppCredentialMetadata | null> {
    contextFor(request);
    const record = await this.repository.findForOwner(request);
    return record ? safeMetadata(record) : null;
  }

  async disable(request: MetaWhatsAppCredentialRequest & { expectedVersion: number }): Promise<MetaWhatsAppCredentialMetadata> {
    return this.changeStatus(request, "disabled");
  }

  async revoke(request: MetaWhatsAppCredentialRequest & { expectedVersion: number }): Promise<MetaWhatsAppCredentialMetadata> {
    return this.changeStatus(request, "revoked");
  }

  async enable(request: MetaWhatsAppCredentialRequest & { expectedVersion: number }): Promise<MetaWhatsAppCredentialMetadata> {
    contextFor(request);
    if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1 || !await this.repository.enable(request, request.expectedVersion)) {
      throw new MetaWhatsAppCredentialError("Meta WhatsApp credential enablement was rejected due to a stale or non-disabled credential.");
    }
    const record = await this.repository.findForOwner(request);
    if (!record) throw new MetaWhatsAppCredentialError("Meta WhatsApp credential could not be read after enablement.");
    return safeMetadata(record);
  }

  private async changeStatus(
    request: MetaWhatsAppCredentialRequest & { expectedVersion: number },
    status: "disabled" | "revoked",
  ): Promise<MetaWhatsAppCredentialMetadata> {
    contextFor(request);
    if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1) {
      throw new MetaWhatsAppCredentialError("Credential version is invalid.");
    }
    const changed = await this.repository.setStatus(request, request.expectedVersion, status);
    if (!changed) {
      throw new MetaWhatsAppCredentialError("Meta WhatsApp credential status change was rejected due to a stale or inactive credential.");
    }
    const record = await this.repository.findForOwner(request);
    if (!record) throw new MetaWhatsAppCredentialError("Meta WhatsApp credential could not be read after status change.");
    return safeMetadata(record);
  }
}

export function createMetaWhatsAppCredentialVault(
  db: D1Database,
  bindings: Pick<
    AppBindings,
    "META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS" | "META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION"
  >,
): MetaWhatsAppCredentialVault {
  if (!bindings.META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS?.trim() || !bindings.META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION?.trim()) {
    throw new MetaWhatsAppCredentialError("Meta WhatsApp credential encryption is not configured.");
  }
  return new MetaWhatsAppCredentialVault(
    new MetaWhatsAppCredentialRepository(db),
    CredentialCipher.fromConfiguration({
      keyring: bindings.META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS,
      activeKeyVersion: bindings.META_WHATSAPP_CREDENTIAL_ACTIVE_KEY_VERSION,
    }),
  );
}
