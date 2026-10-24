export async function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string | undefined): Promise<boolean> {
  if (!header?.startsWith("sha256=") || !appSecret?.trim()) return false;
  const supplied = header.slice(7).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(supplied)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let mismatch = supplied.length === expected.length ? 0 : 1;
  for (let index = 0; index < Math.min(supplied.length, expected.length); index++) mismatch |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}
