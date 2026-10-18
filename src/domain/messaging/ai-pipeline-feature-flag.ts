/**
 * Exact tenant allowlist for AI Pipeline V2.
 *
 * Fails closed when the binding is missing or empty.
 * Does not support wildcard tenant IDs.
 */
export function isAIPipelineV2TenantAllowed(
  tenantId: string | null | undefined,
  allowlist: string | null | undefined,
): boolean {
  const normalizedTenantId =
    typeof tenantId === "string"
      ? tenantId.trim().toLowerCase()
      : "";

  if (!normalizedTenantId || !allowlist?.trim()) {
    return false;
  }

  const allowedTenantIds = new Set(
    allowlist
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );

  return allowedTenantIds.has(normalizedTenantId);
}

export function scheduleAIPipelineShadowIfAllowed(input: {
  tenantId: string | null | undefined;
  allowlist: string | null | undefined;
  scheduleBackgroundTask?: (
    task: Promise<unknown>,
  ) => void;
  run: () => Promise<unknown>;
}): boolean {
  if (
    !input.scheduleBackgroundTask ||
    !isAIPipelineV2TenantAllowed(
      input.tenantId,
      input.allowlist,
    )
  ) {
    return false;
  }

  input.scheduleBackgroundTask(
    Promise.resolve().then(input.run),
  );

  return true;
}