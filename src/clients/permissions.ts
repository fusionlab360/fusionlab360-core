/** Permission scopes enforced by protected API routes. */
export const PERMISSION_SCOPES = [
  "contacts:create",
  "contacts:read",
  "contacts:update",
  "contacts:delete",
  "reservations:sync",
  "booking:read",
  "booking:create",
  "booking:test",
  "integrations:read",
  "integrations:write",
  "integrations:oauth:connect",
  "integrations:test",
  "messaging:test",
  "ai:read",
  "ai:write",
  "ai:test",
  "knowledge:read",
  "knowledge:write",
  "knowledge:answer",
  "knowledge:evaluate",
  "features:read",
  "features:write",
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];
export const LEGACY_WILDCARD_PERMISSION = "*" as const;

const supportedScopes: ReadonlySet<string> = new Set(PERMISSION_SCOPES);

export function isPermissionScope(value: string): value is PermissionScope {
  return supportedScopes.has(value);
}

export function parsePermissionScopes(
  values: readonly string[],
  options: { allowLegacyWildcardRevocation?: boolean } = {},
): Array<PermissionScope | typeof LEGACY_WILDCARD_PERMISSION> {
  if (values.length === 0) {
    throw new Error("At least one permission scope is required.");
  }

  if (values.some((value) => value !== value.trim())) {
    throw new Error("Permission scopes must not contain surrounding whitespace.");
  }
  const scopes: Array<PermissionScope | typeof LEGACY_WILDCARD_PERMISSION> = [];
  const invalid: string[] = [];
  for (const scope of values) {
    if (isPermissionScope(scope)) {
      scopes.push(scope);
    } else if (
      options.allowLegacyWildcardRevocation &&
      scope === LEGACY_WILDCARD_PERMISSION
    ) {
      scopes.push(LEGACY_WILDCARD_PERMISSION);
    } else {
      invalid.push(scope);
    }
  }
  if (invalid.length > 0) {
    throw new Error(`Unsupported permission scope: ${invalid.join(", ")}`);
  }

  return [...new Set(scopes)];
}
