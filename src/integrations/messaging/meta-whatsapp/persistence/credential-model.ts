export type MetaWhatsAppCredentialStatus = "active" | "disabled" | "revoked";

export interface MetaWhatsAppCredentialRecord {
  id: string;
  tenantId: string;
  integrationId: string;
  connectionId: string;
  provider: "meta_whatsapp";
  status: MetaWhatsAppCredentialStatus;
  ciphertext: string | null;
  nonce: string | null;
  algorithm: "AES-GCM";
  keyVersion: string;
  credentialVersion: number;
  metadata: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MetaWhatsAppCredentialMetadata {
  id: string;
  tenantId: string;
  integrationId: string;
  connectionId: string;
  provider: "meta_whatsapp";
  status: MetaWhatsAppCredentialStatus;
  keyVersion: string;
  credentialVersion: number;
  metadata: Record<string, unknown>;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
