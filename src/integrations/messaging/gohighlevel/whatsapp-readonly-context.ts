import CryptoJS from "crypto-js";
import type { D1Database } from "@cloudflare/workers-types";
import { GHLReadonlyInstallationRepository, type GHLReadonlyInstallationRecord } from "./whatsapp-readonly-installation-repository";

export interface GHLReadonlyContextAllowlist {
  tenant: string;
  location: string;
  user: string;
  company: string;
  app: string;
  sharedSecret: string;
}

export type GHLReadonlyContextValidation =
  | { verified: true; installation: GHLReadonlyInstallationRecord }
  | { verified: false; code: string };

const ENCRYPTED_CONTEXT_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Validates HighLevel's existing encrypted Custom Page context against the
 * same fixed identity allowlists and locally recorded installation ownership
 * used by the read-only status route. This function performs no provider call
 * and exposes no decrypted identity data.
 */
export async function validateGHLReadonlyContext(
  db: D1Database,
  configuration: GHLReadonlyContextAllowlist,
  encryptedContext: unknown,
): Promise<GHLReadonlyContextValidation> {
  if (encryptedContext === undefined || encryptedContext === null || encryptedContext === "") {
    return { verified: false, code: "CONTEXT_NOT_RECEIVED" };
  }
  if (
    typeof encryptedContext !== "string" || encryptedContext.length > 8192 ||
    encryptedContext.length < 16 || !ENCRYPTED_CONTEXT_PATTERN.test(encryptedContext)
  ) return { verified: false, code: "CONTEXT_MALFORMED" };

  let context: Record<string, unknown>;
  try {
    const raw = CryptoJS.AES.decrypt(encryptedContext, configuration.sharedSecret).toString(CryptoJS.enc.Utf8);
    if (!raw) return { verified: false, code: "CONTEXT_DECRYPT_FAILED" };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { verified: false, code: "CONTEXT_MALFORMED" };
    }
    context = parsed as Record<string, unknown>;
  } catch {
    return { verified: false, code: "CONTEXT_DECRYPT_FAILED" };
  }

  const locationId = context.activeLocation;
  const userId = context.userId;
  const companyId = context.companyId;
  if (
    (context.type !== "location" && context.type !== "agency") ||
    typeof locationId !== "string" || typeof userId !== "string" || typeof companyId !== "string"
  ) return { verified: false, code: "CONTEXT_MALFORMED" };
  if (context.role !== "admin" || userId !== configuration.user) {
    return { verified: false, code: "USER_NOT_ALLOWED" };
  }
  if (locationId !== configuration.location) {
    return { verified: false, code: "LOCATION_NOT_ALLOWED" };
  }
  if (companyId !== configuration.company) {
    return { verified: false, code: "COMPANY_NOT_ALLOWED" };
  }
  if (context.appStatus !== "live") {
    return { verified: false, code: "APP_NOT_ALLOWED" };
  }

  const installation = await new GHLReadonlyInstallationRepository(db)
    .findUniqueForLocation(locationId, configuration.app, companyId);
  if (!installation || installation.tenantId !== configuration.tenant || installation.tenantStatus !== "active" || !installation.integrationEnabled) {
    return { verified: false, code: "INSTALLATION_NOT_MATCHED" };
  }
  if (!installation.appMatches) return { verified: false, code: "APP_NOT_ALLOWED" };
  if (!installation.companyMatches) return { verified: false, code: "COMPANY_NOT_ALLOWED" };
  if (!installation.locationMatches) return { verified: false, code: "LOCATION_NOT_ALLOWED" };
  if (
    installation.credentialAuthType !== "oauth2" || !installation.credentialConfigured ||
    !installation.connectedMetadata || !installation.locationAccountMetadata
  ) return { verified: false, code: "INSTALLATION_NOT_MATCHED" };

  return { verified: true, installation };
}
