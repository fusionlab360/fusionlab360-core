import { bootstrapSecurity } from "./bootstrap/security";
import "./bootstrap/routes";
import { app } from "./config/app";
import type { AppBindings } from "./config/app";
import type { GHLInboundQueueEnvelope } from "./domain/messaging/inbound-queue-contract";
import { consumeGHLInboundQueue } from "./domain/messaging/inbound-queue";

export async function queue(
  batch: MessageBatch<GHLInboundQueueEnvelope>,
  env: AppBindings,
): Promise<void> {
  await consumeGHLInboundQueue(batch, env);
}

const worker: ExportedHandler<AppBindings, GHLInboundQueueEnvelope> = {
  fetch: (request, env, executionCtx) => app.fetch(request, env, executionCtx),
  queue,
};

export default worker;
