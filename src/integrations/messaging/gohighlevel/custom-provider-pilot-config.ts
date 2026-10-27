export interface GHLCustomProviderPilotConfiguration {
  GHL_CUSTOM_PROVIDER_ENABLED?: string;
  GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST?: string;
}

const LOCATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The M0 pilot intentionally accepts one location only. Keeping the value
 * singular prevents accidentally broadening an installed Marketplace app.
 */
export function resolveSingleGHLProviderPilotLocation(
  allowlist: string | undefined,
): string | null {
  const value = allowlist?.trim();
  if (!value || value.includes(",") || value.includes("*") || !LOCATION_ID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

export function isGHLProviderPilotLocationAuthorized(
  configuration: GHLCustomProviderPilotConfiguration,
  locationId: string | undefined,
): boolean {
  if (configuration.GHL_CUSTOM_PROVIDER_ENABLED !== "true") return false;
  const allowedLocation = resolveSingleGHLProviderPilotLocation(
    configuration.GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST,
  );
  return Boolean(allowedLocation && locationId?.trim() === allowedLocation);
}

export function requireGHLProviderPilotLocation(
  configuration: GHLCustomProviderPilotConfiguration,
  locationId: string | undefined,
): string {
  const normalizedLocationId = locationId?.trim();
  if (!isGHLProviderPilotLocationAuthorized(configuration, normalizedLocationId)) {
    throw new Error("GHL Custom Conversation Provider is not authorized for this location.");
  }
  return normalizedLocationId!;
}
