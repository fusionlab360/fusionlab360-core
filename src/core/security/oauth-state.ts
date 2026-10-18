/**
 * Generates a cryptographically random OAuth state token.
 *
 * The raw token must be returned only to the authorization flow.
 * Persist its SHA-256 hash rather than the raw token.
 */
export function createOAuthStateToken(): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(32),
  );

  return Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashOAuthStateToken(
  state: string,
): Promise<string> {
  if (!state || !state.trim()) {
    throw new Error("OAuth state is required.");
  }

  const data = new TextEncoder().encode(state);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    data,
  );

  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}