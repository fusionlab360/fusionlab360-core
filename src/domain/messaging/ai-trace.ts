export type AITraceOutcome =
  | "answered"
  | "answered_partial"
  | "handoff"
  | "ai_meta"
  | "cancelled"
  | "provider_fallback";

export type AITraceStage =
  | "scope"
  | "retrieval"
  | "answerability"
  | "generation"
  | "grounding"
  | "handoff"
  | "delivery";

export interface AITraceStageRecord {
  stage:
    AITraceStage;

  status:
    "started" |
    "completed" |
    "failed" |
    "skipped";

  timestamp:
    string;

  details?:
    Record<
      string,
      unknown
    >;
}

export interface AIExecutionTrace {
  traceId:
    string;

  tenantId:
    string;

  conversationId:
    string;

  messageId:
    string;

  startedAt:
    string;

  workerVersion?: {
    id: string;
    tag?: string;
    timestamp?: string;
  };

  completedAt?:
    string;

  durationMs?:
    number;

  scope?:
    "business" |
    "ai_meta";

  mode?:
    string;

  intent?:
    string;

  intents?:
    string[];

  answerability?:
    {
      decision:
        string;

      confidence:
        string;

      reason:
        string;
    };

  retrieval?:
    {
      retrievedCount:
        number;

      selectedCount:
        number;

      knowledgeCoverageStatus?:
        string;

      knowledgeAttributeCoverageStatus?:
        string;
    };

  generation?:
    {
      attempts:
        number;

      providers:
        string[];

      models:
        string[];

      responseLength?:
        number;

      providerAttempts?: Array<{
        provider: string;
        durationMs: number;
        outcome: "success" | "error" | "timeout";
      }>;

      durationMs?: number;

      outcome?: "success" | "incomplete" | "error";

      fallbackUsed:
        boolean;

      error?:
        string;
    };

  grounding?:
    {
      attempts:
        number;

      valid:
        boolean;

      unsupportedFactCount:
        number;

      reason?:
        string;
    };

  handoff?:
    {
      triggered:
        boolean;

      reason:
        string;

      deterministic:
        boolean;
    };

  outcome?:
    AITraceOutcome;

  stages:
    AITraceStageRecord[];
}

export function createAIExecutionTrace(
  input: {
    tenantId:
      string;

    conversationId:
      string;

    messageId:
      string;
  },
):
  AIExecutionTrace {

  return {
    traceId:
      crypto.randomUUID(),

    tenantId:
      input.tenantId,

    conversationId:
      input.conversationId,

    messageId:
      input.messageId,

    startedAt:
      new Date().toISOString(),

    stages:
      [],
  };
}

export function addAITraceStage(
  trace:
    AIExecutionTrace,

  stage:
    AITraceStage,

  status:
    AITraceStageRecord["status"],

  details?:
    Record<
      string,
      unknown
    >,
):
  void {

  trace.stages.push(
    {
      stage,

      status,

      timestamp:
        new Date().toISOString(),

      ...(details
        ? {
            details,
          }
        : {}),
    },
  );
}

export function completeAIExecutionTrace(
  trace:
    AIExecutionTrace,

  outcome:
    AITraceOutcome,
):
  void {

  trace.outcome =
    outcome;

  trace.completedAt =
    new Date().toISOString();

  trace.durationMs =
    new Date(
      trace.completedAt,
    ).getTime() -
    new Date(
      trace.startedAt,
    ).getTime();

  emitAIExecutionTrace(
    trace,
  );
}

export function emitAIExecutionTrace(
  trace:
    AIExecutionTrace,
):
  void {

  console.log(
    "AI TRACE",
    trace,
  );
}
