export function createEventId(): string {
  return crypto.randomUUID();
}

export async function createTenantScopedEventId(
  tenantId: string,
  provider: string | undefined,
  sourceEventId: string,
): Promise<string> {
  const identity = JSON.stringify([
    tenantId,
    provider ?? "",
    sourceEventId,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  const suffix = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `evt_${suffix}`;
}
