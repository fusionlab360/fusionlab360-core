export type InboundProcessingOperation =
  | "synchronous_webhook"
  | "queue_consumer"
  | "tenant_resolution"
  | "queue_publish"
  | "event_accept"
  | "event_claim"
  | "conversation_history"
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
  | "cancelled"
  | "timeout"
  | "unknown";

export type InboundExecutionPath =
  | "synchronous_webhook"
  | "queue_consumer";

export type InboundProcessingOutcome =
  | "newer_message"
  | "no_newer_message";

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

export function classifyInboundProcessingError(
  error: unknown,
): InboundProcessingErrorClassification {
  const errorName = error instanceof Error ? error.name : "";
  if (errorName === "AbortError" || errorName === "CanceledError") {
    return "cancelled";
  }
  if (errorName === "TimeoutError") return "timeout";

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

export function logInboundCheckpoint(
  operation: InboundProcessingOperation,
  phase: "start" | "complete" | "failed",
  correlationId: string,
  startedAt?: number,
  error?: unknown,
  outcome?: InboundProcessingOutcome,
): void {
  const fields = {
    operation,
    phase,
    correlationId,
    ...(startedAt === undefined ? {} : { elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)) }),
    ...(phase === "failed" ? { classification: classifyInboundProcessingError(error) } : {}),
    ...(operation === "newer_message_check" && outcome ? { outcome } : {}),
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
): void {
  logInboundCheckpoint(path, "start", correlationId);
}

export async function traceInboundOperation<T>(
  operation: InboundProcessingOperation,
  correlationId: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  logInboundCheckpoint(operation, "start", correlationId);
  try {
    const result = await run();
    logInboundCheckpoint(operation, "complete", correlationId, startedAt);
    return result;
  } catch (error: unknown) {
    logInboundCheckpoint(operation, "failed", correlationId, startedAt, error);
    throw error;
  }
}
