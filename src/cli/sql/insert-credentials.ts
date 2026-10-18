import { sqlLiteral } from "./literal";

export interface InsertPendingOAuthCredentialInput {
  tenantId: string;
  provider: string;
  companyId: string;
  locationId: string;
}

/**
 * Registers non-secret provider identifiers for a pending OAuth connection.
 * It never requests or stores a Private Integration Token (PIT).
 */
export function buildInsertPendingOAuthCredentialSql(
  input: InsertPendingOAuthCredentialInput,
): string {
  const companyId = input.companyId.trim();
  const locationId = input.locationId.trim();

  if (!companyId || !locationId) {
    throw new Error("GHL Company ID and Location ID are required.");
  }

  if (input.provider !== "gohighlevel") {
    throw new Error(
      "Pending OAuth onboarding is currently implemented only for GoHighLevel.",
    );
  }

  const metadata = JSON.stringify({
    accountType: "location",
    companyId,
    locationId,
    connectionStatus: "pending_oauth",
  });

  return `
INSERT INTO integration_credentials (
  tenant_id,
  provider,
  auth_type,
  api_key,
  location_id,
  refresh_token,
  access_token_expires_at,
  metadata
)
VALUES (
  ${sqlLiteral(input.tenantId)},
  ${sqlLiteral(input.provider)},
  'oauth2',
  NULL,
  ${sqlLiteral(locationId)},
  NULL,
  NULL,
  ${sqlLiteral(metadata)}
);
`;
}