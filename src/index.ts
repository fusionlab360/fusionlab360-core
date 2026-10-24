import {
  createApplication,
  shouldEnableNonProductionRoutes,
} from "./bootstrap/routes";
import type { AppBindings } from "./config/app";
import type { GHLInboundQueueEnvelope } from "./domain/messaging/inbound-queue-contract";
import { consumeGHLInboundQueue } from "./domain/messaging/inbound-queue";
import type { ReservationIntegrationEventConsumer } from "./domain/reservation/integration-event-consumer";
import { IntegrationEventRepository } from "./persistence/repositories/integration-event-repository";
import { IntegrationEventService } from "./core/events/service";
import type { createSTAAHRoutes } from "./integrations/channel-manager/staah/staah-routes";
import { createMetaWhatsAppInboundHandler } from "./integrations/messaging/meta-whatsapp/inbound-handler";
import { areNewQueueEnvelopesEnabled } from "./domain/messaging/inbound-queue";
export async function queue(
  batch: MessageBatch<GHLInboundQueueEnvelope>,
  env: AppBindings,
  executionCtx: ExecutionContext,
  reservationConsumer?: ReservationIntegrationEventConsumer,
): Promise<void> {
  await consumeGHLInboundQueue(
    batch,
    env,
    (task) => executionCtx.waitUntil(task),
    reservationConsumer,
    new Map([["meta_whatsapp", createMetaWhatsAppInboundHandler()]]),
  );
}

/** Existing Worker execution surface; no cron or production mock is enabled here. */
export async function scheduled(
  _controller: ScheduledController,
  env: AppBindings,
  _executionCtx: ExecutionContext,
  reservationConsumer?: ReservationIntegrationEventConsumer,
): Promise<void> {
  if (!reservationConsumer || !env.GHL_INBOUND_QUEUE || !areNewQueueEnvelopesEnabled(env)) return;
  const destinationQueue = env.GHL_INBOUND_QUEUE;
  const service = new IntegrationEventService(new IntegrationEventRepository(env.DB));
  await service.dispatchPendingReservations(async ({ tenantId, eventId }) => {
    await destinationQueue.send({ version: 1, kind: "reservation", tenantId, sourceEventId: eventId });
  });
}

const productionApplication = createApplication("production");
const nonProductionApplication = createApplication("staging");

/**
 * Worker composition.
 *
 * Default export:
 * - production/staging routes as before
 * - no automatically configured reservation consumer
 * - no local mock STAAH route injection
 *
 * Trusted local composition:
 * - explicitly supplied reservation consumer and STAAH routes
 * - activated only when APP_ENVIRONMENT === "development"
 */
export function createWorker(
  reservationConsumer?: ReservationIntegrationEventConsumer,
  localSTAAHRoutes?: ReturnType<typeof createSTAAHRoutes>,
): ExportedHandler<AppBindings, GHLInboundQueueEnvelope> {
  const localMockApplication = localSTAAHRoutes
    ? createApplication("development", localSTAAHRoutes)
    : undefined;

  function isLocalMockActive(env: AppBindings): boolean {
    return (
      localSTAAHRoutes !== undefined &&
      env.APP_ENVIRONMENT === "development"
    );
  }

  return {
    fetch: (request, env, executionCtx) => {
      const application = isLocalMockActive(env)
        ? localMockApplication!
        : shouldEnableNonProductionRoutes(env.APP_ENVIRONMENT)
          ? nonProductionApplication
          : productionApplication;

      return application.fetch(request, env, executionCtx);
    },

    queue: (batch, env, ctx) => {
      const selectedConsumer = localSTAAHRoutes
        ? isLocalMockActive(env)
          ? reservationConsumer
          : undefined
        : reservationConsumer;

      return queue(batch, env, ctx, selectedConsumer);
    },

    scheduled: (controller, env, ctx) => {
      const selectedConsumer = localSTAAHRoutes
        ? isLocalMockActive(env)
          ? reservationConsumer
          : undefined
        : reservationConsumer;

      return scheduled(controller, env, ctx, selectedConsumer);
    },
  };
}

export default createWorker();
