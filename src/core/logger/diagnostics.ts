import { logger } from "./index";

export type DiagnosticCode =
  | "AUTH_FAILURE" | "TENANT_RESOLUTION_FAILED"
  | "CREDENTIAL_LEGACY_READ_DISABLED" | "CREDENTIAL_KEYRING_MISSING"
  | "CREDENTIAL_DECRYPT_FAILED" | "OAUTH_ACCESS_EXPIRED"
  | "OAUTH_REFRESH_FAILED" | "OAUTH_PERSIST_FAILED"
  | "PROVIDER_REQUEST_FAILED" | "DATABASE_OPERATION_FAILED"
  | "QUEUE_OPERATION_FAILED" | "VALIDATION_FAILED" | "INTERNAL_ERROR";

export type DiagnosticEvent =
  | "http.start" | "http.complete" | "auth" | "tenant" | "permission"
  | "ghl.credential.lookup" | "ghl.cipher" | "ghl.credential.read"
  | "meta.webhook.signature" | "meta.webhook.parse" | "meta.webhook.dispatch"
  | "ghl.provider" | "ghl.webhook.signature" | "ghl.webhook.parse" | "ghl.webhook.tenant" | "queue.consume" | "reservation.publish"
  | "knowledge.vector" | "knowledge.lexical" | "knowledge.rerank" | "contact.validation" | "contact.service"
  | "ghl.expiry" | "ghl.refresh" | "ghl.persistence";

export type DiagnosticOutcome = "started" | "succeeded" | "failed"
  | "available" | "absent" | "legacy" | "encrypted" | "empty" | "usable" | "refresh_required" | "retry";

export function createDiagnostics(mode?: string, trustedCorrelationId?: string) {
  const correlationId = trustedCorrelationId &&
    /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|ghl-in-[a-f0-9]{24})$/.test(trustedCorrelationId)
    ? trustedCorrelationId
    : crypto.randomUUID();
  let failure: { stage: DiagnosticEvent; code: DiagnosticCode } | undefined;

  function emit(event: DiagnosticEvent, outcome: DiagnosticOutcome, code?: DiagnosticCode,
    http?: { method?: string; route?: string; status?: number; durationMs?: number; authenticationType?: "api_key" | "jwt" }) {
    if (outcome === "failed" && code && event !== "http.complete") {
      failure = { stage: event, code };
    }
    // OFF only suppresses this logger. Default mode emits failed HTTP completions and operational failures/retries.
    if (mode === "OFF" || (mode !== "DEBUG" && !((event === "http.complete" || event === "queue.consume" || event === "reservation.publish" || event.startsWith("knowledge.")) && (outcome === "failed" || outcome === "retry")))) return;
    // Routes come from router registration, never from the request URL.
    const method = http?.method;
    const route = http?.route;
    const status = http?.status;
    const durationMs = http?.durationMs;
    const authenticationType = http?.authenticationType;
    logger.diagnostic({
      correlationId, event, outcome, code,
      ...(event === "http.complete" && outcome === "failed" && failure ? { stage: failure.stage } : {}),
      method: method && /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|CONNECT|TRACE)$/.test(method) ? method : undefined,
      route: route && route.length <= 200 && /^\/[\w/:.-]*$/.test(route) ? route : undefined,
      status: status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
      durationMs: durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
      authenticationType: authenticationType === "api_key" || authenticationType === "jwt" ? authenticationType : undefined,
    });
  }

  return { correlationId, emit, failureCode: () => failure?.code };
}

export type RequestDiagnostics = ReturnType<typeof createDiagnostics>;
