import type { CanonicalInboundMessage } from "../../canonical/message";

export interface GHLInboundQueueEnvelope {
  version: 1;
  tenantId: string;
  provider: "gohighlevel";
  sourceEventId: string;
  message: CanonicalInboundMessage;
}
