export type MetaTransportFailureCategory =
  | "aborted"
  | "fetch_type_error"
  | "network_error"
  | "invalid_url"
  | "unclassified";

/**
 * Classify only runtime facts that are stable and safe to persist.
 * Exception messages and objects are intentionally ignored.
 */
export function classifyMetaTransportError(error: unknown): MetaTransportFailureCategory {
  const name = error && typeof error === "object" && "name" in error
    ? (error as { name?: unknown }).name
    : undefined;

  if (name === "AbortError" || name === "TimeoutError") return "aborted";
  if (name === "TypeError") return "fetch_type_error";
  if (name === "NetworkError") return "network_error";
  return "unclassified";
}

export function formatMetaTransportErrorCode(
  code: string,
  category: MetaTransportFailureCategory | undefined,
): string {
  return category ? `${code}:${category}` : code;
}
