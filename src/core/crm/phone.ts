/**
 * Normalize a phone number without assuming a tenant's country.
 * Explicit international prefixes are canonicalized to `+` form; local
 * numbers remain local so callers do not silently apply a country code.
 */
export function normalizePhoneNumber(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (hasPlus) return `+${digits}`;
  if (/^00\d/.test(trimmed.replace(/[\s().-]/g, ""))) return `+${digits.slice(2)}`;
  return digits;
}

/** Normalize an explicitly international customer number to E.164. */
export function normalizeInternationalPhoneNumber(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s().-]/g, "");
  const digits = compact.startsWith("00")
    ? compact.slice(2)
    : compact.startsWith("+")
      ? compact.slice(1)
      : "";
  if (!/^\d{7,15}$/.test(digits) || digits.startsWith("0")) return null;
  return `+${digits}`;
}

export function isValidPhoneNumber(value: string | null | undefined): boolean {
  return normalizePhoneNumber(value) !== null;
}
