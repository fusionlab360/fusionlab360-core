import type { AppBindings } from "../../../config/app";
import type { GHLInboundQueueEnvelope } from "../../../domain/messaging/inbound-queue-contract";

import {
  createGHLMockEnvironment,
} from "../../crm/gohighlevel/testing/mock-transport";

import {
  goHighLevelAdapter,
} from "../../crm/gohighlevel/adapter";

import {
  ReservationIntegrationEventConsumer,
  type ReservationEventConsumerDependencies,
} from "../../../domain/reservation/integration-event-consumer";

import {
  STAAHMockSynchronizationService,
} from "./staah-sync";

import { createSTAAHRoutes } from "./staah-routes";
import { createWorker } from "../../../index";

import {
  STAAHConnectionManagementService,
} from "./staah-management";

import {
  STAAHMockBookingRepository,
} from "./staah-mock-booking-repository";

import {
  STAAHMockBookingSubmissionService,
} from "./staah-mock-booking-submission";

export interface LocalSTAAHMockOptions {
  db: D1Database;

  /**
   * Optional, separate disposable local D1.
   * Contains only synthetic booking submissions.
   *
   * Must NOT be the Core database.
   * Must NOT be a production D1 binding.
   */
  mockBookingDb?: D1Database;

  tenantId: string;

  locationId: string;
  reservationFieldId: string;

  /**
   * Creates tenant-specific canonical CRM context.
   * The factory replaces its integration runtime with
   * the synthetic GHL runtime before use.
   */
  createDestinationContext:
    ReservationEventConsumerDependencies["createDestinationContext"];
}

/**
 * Explicit local development composition only.
 *
 * This is never imported by the default Worker entry.
 * It cannot be activated by HTTP request input or
 * persisted database settings.
 */
export function createLocalSTAAHMockWorker(
  options: LocalSTAAHMockOptions,
) {
  const tenantId = options.tenantId.trim();
  const locationId = options.locationId.trim();
  const reservationFieldId = options.reservationFieldId.trim();

  if (!tenantId || !locationId || !reservationFieldId) {
    throw new Error(
      "Local STAAH mock requires tenant, location and reservation field IDs.",
    );
  }

    // Mock booking persistence must never share
  // the Core database binding.
  if (
    options.mockBookingDb &&
    options.mockBookingDb === options.db
  ) {
    throw new Error(
      "STAAH mock booking D1 must be separate from Core D1.",
    );
  }

  // In-memory synthetic GHL destination.
  // No real provider credentials are resolved.
  const mock = createGHLMockEnvironment({
    tenantId,
    locationId,
    reservationFieldId,
  });

  const pendingEnvelopes: GHLInboundQueueEnvelope[] = [];

  // Local synthetic Queue. No Cloudflare Queue messages
  // are published by this implementation.
  const localQueue = {
    async send(envelope: GHLInboundQueueEnvelope): Promise<void> {
      if (
        envelope.kind !== "reservation" ||
        envelope.tenantId !== tenantId
      ) {
        throw new Error("Local mock Queue envelope scope mismatch.");
      }

      pendingEnvelopes.push(envelope);
    },
  } as unknown as Queue<GHLInboundQueueEnvelope>;

  const consumer = new ReservationIntegrationEventConsumer({
    db: options.db,
    destinationAdapter: goHighLevelAdapter,

    async createDestinationContext(input) {
      if (
        input.tenantId !== tenantId ||
        input.locationId !== locationId
      ) {
        throw new Error("Local mock destination scope mismatch.");
      }

      const context = await options.createDestinationContext(input);

      if (
        context.tenant.id !== tenantId ||
        context.tenant.integrations.crm.id !==
          input.destinationIntegration.id ||
        context.tenant.integrations.crm.credentials.locationId !==
          locationId
      ) {
        throw new Error("Local mock CRM context scope mismatch.");
      }

      // The existing GHL adapter now uses synthetic credentials
      // and synthetic HTTP transport rather than live transport.
      return {
        ...context,
        integrationRuntime: mock.runtime,
      };
    },
  });

    // M6.3C: Booking submission exists only when
  // a separate mock database is explicitly supplied.
  const bookingSubmission = options.mockBookingDb
    ? new STAAHMockBookingSubmissionService(
        new STAAHConnectionManagementService(options.db),
        new STAAHMockBookingRepository(
          options.mockBookingDb,
        ),
      )
    : null;

    const localRoutes = createSTAAHRoutes({
    createSyncService(db) {
      if (db !== options.db) {
        throw new Error(
          "Local STAAH mock database binding mismatch.",
        );
      }

      return new STAAHMockSynchronizationService(
        db,
        undefined,
        undefined,
        {
          consumer,
          queue: localQueue,
        },
      );
    },

    ...(bookingSubmission
      ? {
          submitMockBooking(
            requestTenantId: string,
            integrationId: string,
            input: unknown,
          ) {
            if (requestTenantId !== tenantId) {
              throw new Error(
                "Local mock booking tenant mismatch.",
              );
            }

            return bookingSubmission.submit(
              requestTenantId,
              integrationId,
              input,
            );
          },
        }
      : {}),
  });

  const composedWorker = createWorker(consumer, localRoutes);

  // Require the exact local database and in-memory Queue.
  // A real Worker binding cannot silently replace them.
  function isLocalEnvironment(env: AppBindings): boolean {
    return (
      env.APP_ENVIRONMENT === "development" &&
      env.DB === options.db &&
      env.GHL_INBOUND_QUEUE === localQueue
    );
  }

  const worker: ExportedHandler<
    AppBindings,
    GHLInboundQueueEnvelope
  > = {
    fetch(request, env, ctx) {
      if (!isLocalEnvironment(env)) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "local_mock_not_available",
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return composedWorker.fetch!(request, env, ctx);
    },

    async queue(batch, env, ctx) {
      if (!isLocalEnvironment(env)) {
        throw new Error("Local mock Queue execution is not authorized.");
      }

      await composedWorker.queue!(batch, env, ctx);
    },

    async scheduled(controller, env, ctx) {
      if (!isLocalEnvironment(env)) {
        return;
      }

      await composedWorker.scheduled!(
        controller,
        env,
        ctx,
      );
    },
  };

  return {
    worker,
    queue: localQueue,
    mock,
    consumer,
    pendingEnvelopes,
  };
}