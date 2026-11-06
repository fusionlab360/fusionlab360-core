import { classifyMetaTransportError, type MetaTransportFailureCategory } from "./transport-diagnostics";

export const META_DIAGNOSTIC_TENANT_ID = "gmmetro";
export const META_DIAGNOSTIC_CONNECTION_ID = "bef4feda-206f-491b-a1fe-f805bdeadf18";
export const META_DIAGNOSTIC_PHONE_NUMBER_ID = "1452502451268655";
export const META_DIAGNOSTIC_GRAPH_VERSION = "v26.0";

export interface MetaReadOnlyDiagnosticResult {
  httpResponseReceived: boolean;
  httpStatus: number | null;
  durationCategory: "under_250ms" | "under_1s" | "over_1s" | "unknown";
  safeExceptionClassification: MetaTransportFailureCategory | null;
}

function durationCategory(durationMs: number): MetaReadOnlyDiagnosticResult["durationCategory"] {
  if (!Number.isFinite(durationMs)) return "unknown";
  if (durationMs < 250) return "under_250ms";
  if (durationMs < 1000) return "under_1s";
  return "over_1s";
}

/**
 * Performs the one fixed, read-only Graph request. The response body is never
 * read or returned; the token is used only in the in-memory Authorization header.
 */
export async function probeMetaPhoneResource(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<MetaReadOnlyDiagnosticResult> {
  const started = (input.now ?? Date.now)();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 3000);
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `https://graph.facebook.com/${META_DIAGNOSTIC_GRAPH_VERSION}/${META_DIAGNOSTIC_PHONE_NUMBER_ID}?fields=id`,
      {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${input.accessToken}` },
        redirect: "manual",
        signal: controller.signal,
      },
    );
    response.body?.cancel();
    return {
      httpResponseReceived: true,
      httpStatus: response.status,
      durationCategory: durationCategory((input.now ?? Date.now)() - started),
      safeExceptionClassification: null,
    };
  } catch (error) {
    return {
      httpResponseReceived: false,
      httpStatus: null,
      durationCategory: durationCategory((input.now ?? Date.now)() - started),
      safeExceptionClassification: classifyMetaTransportError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
