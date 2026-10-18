import {
  createApplication,
  shouldEnableNonProductionRoutes,
} from "./bootstrap/routes";
import type { AppBindings } from "./config/app";
import type { GHLInboundQueueEnvelope } from "./domain/messaging/inbound-queue-contract";
import { consumeGHLInboundQueue } from "./domain/messaging/inbound-queue";

export async function queue(
  batch: MessageBatch<GHLInboundQueueEnvelope>,
  env: AppBindings,
  executionCtx: ExecutionContext,
): Promise<void> {
  await consumeGHLInboundQueue(
    batch,
    env,
    (task) => executionCtx.waitUntil(task),
  );
}

const productionApplication = createApplication("production");
const nonProductionApplication = createApplication("staging");

const worker: ExportedHandler<AppBindings, GHLInboundQueueEnvelope> = {
  fetch: (request, env, executionCtx) => {
    const application =
      shouldEnableNonProductionRoutes(env.APP_ENVIRONMENT)
        ? nonProductionApplication
        : productionApplication;

    return application.fetch(request, env, executionCtx);
  },
  queue,
};

export default worker;
