export type InboundProcessingOperation =
  | "synchronous_webhook"
  | "queue_consumer"
  | "queue_dispatch"
  | "tenant_resolution"
  | "queue_publish"
  | "event_accept"
  | "event_claim"
  | "canonical_message_persistence"
  | "conversation_history"
  | "conversation_profile"
  | "session_decision"
  | "ai_chat_feature"
  | "ai_auto_reply_feature"
  | "ai_auto_reply_recheck"
  | "booking_state"
  | "booking_intent"
  | "ai_thinking_delay"
  | "post_thinking_history_fetch"
  | "newer_message_check"
  | "knowledge_query_rewrite"
  | "knowledge_retrieval"
  | "ai_instructions"
  | "llm_request"
  | "ai_generation"
  | "reply_preparation"
  | "outbound_delivery"
  | "event_completion";

export type InboundProcessingErrorClassification =
  | "database_schema"
  | "database_constraint"
  | "database_unavailable"
  | "provider_http"
  | "provider_response"
  | "provider_transport"
  | "cancelled"
  | "timeout"
  | "unknown";

export type InboundExecutionPath =
  | "synchronous_webhook"
  | "queue_consumer";

export type InboundProcessingOutcome =
  | "newer_message"
  | "no_newer_message";

export type WorkerVersionMetadataBinding = Pick<
  WorkerVersionMetadata,
  "id" | "tag" | "timestamp"
>;

export interface WorkerVersionIdentity {
  workerVersionId: string;
  workerVersionTag?: string;
  workerVersionTimestamp?: string;
}

export function getWorkerVersionIdentity(
  metadata?: WorkerVersionMetadataBinding | null,
): WorkerVersionIdentity | undefined {
  if (!metadata || typeof metadata.id !== "string" || !metadata.id.trim()) {
    return undefined;
  }

  const tag = typeof metadata.tag === "string" ? metadata.tag.trim() : "";
  const timestamp = typeof metadata.timestamp === "string" ? metadata.timestamp.trim() : "";
  return {
    workerVersionId: metadata.id.trim(),
    ...(tag ? { workerVersionTag: tag } : {}),
    ...(timestamp ? { workerVersionTimestamp: timestamp } : {}),
  };
}

export async function createInboundCorrelationId(
  sourceEventId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sourceEventId),
  );
  const shortHash = Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `ghl-in-${shortHash}`;
}

export function getInboundEventAgeMs(
  occurredAt: string,
  receivedAtMs: number = Date.now(),
): number | null {
  const occurredAtMs = Date.parse(occurredAt);
  return Number.isFinite(occurredAtMs) && Number.isFinite(receivedAtMs)
    ? Math.max(0, receivedAtMs - occurredAtMs)
    : null;
}

export function classifyInboundProcessingError(
  error: unknown,
): InboundProcessingErrorClassification {
  const errorName = error instanceof Error ? error.name : "";
  if (errorName === "AbortError" || errorName === "CanceledError") {
    return "cancelled";
  }
  if (errorName === "TimeoutError") return "timeout";

  const providerFailureKind = getProviderFailureKind(error);
  if (providerFailureKind === "provider_http") return "provider_http";
  if (providerFailureKind === "malformed_response") return "provider_response";
  if (providerFailureKind === "transport") return "provider_transport";
  if (providerFailureKind === "timeout") return "timeout";
  if (providerFailureKind === "cancelled") return "cancelled";
  if ((getInboundProviderHTTPStatus(error) ?? 0) >= 400) return "provider_http";

  try {
    const messages: string[] = [];
    let current: unknown = error;

    for (let depth = 0; depth < 3 && current; depth += 1) {
      if (current instanceof Error) {
        messages.push(current.name, current.message);
        current = current.cause;
        continue;
      }

      if (typeof current === "object") {
        const value = current as { code?: unknown; message?: unknown; cause?: unknown; causeValue?: unknown };
        if (typeof value.code === "string") messages.push(value.code);
        if (typeof value.message === "string") messages.push(value.message);
        current = value.cause ?? value.causeValue;
        continue;
      }

      if (typeof current === "string") messages.push(current);
      break;
    }

    const safeText = messages.join(" ");
    if (/AbortError|CanceledError/i.test(safeText)) return "cancelled";
    if (/TimeoutError/i.test(safeText)) return "timeout";
    if (/no such (table|column)|unknown column|has no column named|no column named|does not exist/i.test(safeText)) {
      return "database_schema";
    }
    if (/SQLITE_CONSTRAINT|constraint failed|UNIQUE constraint|FOREIGN KEY constraint|NOT NULL constraint/i.test(safeText)) {
      return "database_constraint";
    }
    if (/database (is )?(locked|busy|unavailable|overloaded)|temporarily unavailable|timed? out|timeout|connection (is )?(closed|lost)/i.test(safeText)) {
      return "database_unavailable";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function getInboundProviderHTTPStatus(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as { httpStatus?: unknown; status?: unknown; cause?: unknown; causeValue?: unknown };
    const status = value.httpStatus ?? value.status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
    current = value.cause ?? value.causeValue;
  }
  return undefined;
}

function getProviderFailureKind(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as { failureKind?: unknown; cause?: unknown; causeValue?: unknown };
    if (value.failureKind === "provider_http" || value.failureKind === "transport" ||
        value.failureKind === "timeout" || value.failureKind === "cancelled" ||
        value.failureKind === "malformed_response") {
      return value.failureKind;
    }
    current = value.cause ?? value.causeValue;
  }
  return undefined;
}

export function getInboundRetryClassification(error: unknown): "retryable" | "permanent" | "unknown" {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as { retryable?: unknown; cause?: unknown; causeValue?: unknown };
    if (typeof value.retryable === "boolean") return value.retryable ? "retryable" : "permanent";
    current = value.cause ?? value.causeValue;
  }
  return "unknown";
}

export function getInboundProviderErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as { providerErrorCode?: unknown; cause?: unknown; causeValue?: unknown };
    if (typeof value.providerErrorCode === "string" && /^[a-z0-9_.-]{1,64}$/i.test(value.providerErrorCode)) {
      return value.providerErrorCode;
    }
    current = value.cause ?? value.causeValue;
  }
  return undefined;
}

export function logInboundCheckpoint(
  operation: InboundProcessingOperation,
  phase: "start" | "complete" | "failed",
  correlationId: string,
  startedAt?: number,
  error?: unknown,
  outcome?: InboundProcessingOutcome,
  workerVersion?: WorkerVersionMetadataBinding | null,
): void {
  const versionIdentity = getWorkerVersionIdentity(workerVersion);
  const fields = {
    operation,
    phase,
    correlationId,
    ...(startedAt === undefined ? {} : { elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)) }),
    ...(phase === "failed" ? { classification: classifyInboundProcessingError(error) } : {}),
    ...(phase === "failed" && getInboundProviderHTTPStatus(error) !== undefined
      ? { httpStatus: getInboundProviderHTTPStatus(error) }
      : {}),
    ...(phase === "failed" ? { retryClassification: getInboundRetryClassification(error) } : {}),
    ...(phase === "failed" && getInboundProviderErrorCode(error)
      ? { providerErrorCode: getInboundProviderErrorCode(error) }
      : {}),
    ...(operation === "newer_message_check" && outcome ? { outcome } : {}),
    ...(versionIdentity ?? {}),
  };
  const message = "GHL inbound lifecycle checkpoint.";

  if (phase === "failed") {
    console.error(message, fields);
  } else {
    console.info(message, fields);
  }
}

export function logInboundExecutionPath(
  path: InboundExecutionPath,
  correlationId: string,
  workerVersion?: WorkerVersionMetadataBinding | null,
): void {
  logInboundCheckpoint(path, "start", correlationId, undefined, undefined, undefined, workerVersion);
}

export function logInboundQueueReceived(
  correlationId: string,
  enqueuedAt: Date,
  attempts: number,
  workerVersion?: WorkerVersionMetadataBinding | null,
): void {
  const enqueuedAtMs = enqueuedAt.getTime();
  const versionIdentity = getWorkerVersionIdentity(workerVersion);
  console.info("GHL inbound Queue message received.", {
    operation: "queue_received",
    correlationId,
    queueWaitMs: Number.isFinite(enqueuedAtMs)
      ? Math.max(0, Date.now() - enqueuedAtMs)
      : null,
    attempts,
    ...(versionIdentity ?? {}),
  });
}

export async function traceInboundOperation<T>(
  operation: InboundProcessingOperation,
  correlationId: string,
  run: () => Promise<T>,
  workerVersion?: WorkerVersionMetadataBinding | null,
): Promise<T> {
  const startedAt = performance.now();
  logInboundCheckpoint(operation, "start", correlationId, undefined, undefined, undefined, workerVersion);
  try {
    const result = await run();
    logInboundCheckpoint(operation, "complete", correlationId, startedAt, undefined, undefined, workerVersion);
    return result;
  } catch (error: unknown) {
    logInboundCheckpoint(operation, "failed", correlationId, startedAt, error, undefined, workerVersion);
    throw error;
  }
}
