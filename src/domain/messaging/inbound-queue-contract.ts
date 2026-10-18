import type { CanonicalInboundMessage } from "../../canonical/message";

export interface GHLInboundQueueMessageEnvelope {
  version: 1;
  kind?: "inbound";
  tenantId: string;
  provider: "gohighlevel";
  sourceEventId: string;
  message: CanonicalInboundMessage;
}

/** Queue only the durable D1 identity; the authoritative payload stays in D1. */
export interface GHLKnowledgeQueueEnvelope {
  version: 1;
  kind: "knowledge";
  tenantId: string;
  provider: "gohighlevel";
  sourceEventId: string;
}

/** Operator replay references a persisted event; it never carries business payload. */
export interface GHLIntegrationEventReplayEnvelope {
  version: 1;
  kind: "event_replay";
  tenantId: string;
  provider: "gohighlevel";
  sourceEventId: string;
}

export type GHLInboundQueueEnvelope =
  | GHLInboundQueueMessageEnvelope
  | GHLKnowledgeQueueEnvelope
  | GHLIntegrationEventReplayEnvelope;
