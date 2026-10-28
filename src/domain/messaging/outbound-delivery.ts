import type {
  IntegrationContext,
} from "../../context/integration";
import {
  IntegrationEventProcessingError,
} from "../../core/events/errors";
import {
  ApiError,
} from "../../core/errors/ApiError";
import type {
  MessagingProvider,
} from "../../core/messaging";
import { KnownNonDeliveryError } from "../../core/messaging";
import {
  MessagingOutboundDeliveryRepository,
} from "../../persistence/repositories/messaging-outbound-delivery-repository";

function unknownOutcome(): IntegrationEventProcessingError {
  return new IntegrationEventProcessingError({
    code: "OUTBOUND_DELIVERY_UNKNOWN",
    severity: "error",
    message: "Outbound delivery outcome is unknown; automatic retry is disabled.",
    retryable: false,
  });
}

function isPermanentProviderRejection(error: unknown): error is ApiError {
  return error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 425, 429].includes(error.status);
}

function permanentProviderRejection(): IntegrationEventProcessingError {
  return new IntegrationEventProcessingError({
    code: "PROVIDER_REQUEST_REJECTED",
    severity: "error",
    message: "Outbound delivery was rejected by the provider.",
    retryable: false,
  });
}

export function withDurableOutboundDelivery(
  db: D1Database,
  provider: MessagingProvider,
  eventId: string,
  renewLease: () => Promise<boolean>,
): MessagingProvider {
  const repository = new MessagingOutboundDeliveryRepository(db);
  let effectNumber = 0;

  return {
    getRecentMessages: (
      context: IntegrationContext,
      conversationId: string,
      limit?: number,
    ) => provider.getRecentMessages(context, conversationId, limit),

    async sendText(context, input) {
      if (!await renewLease()) {
        throw new Error("Inbound event lease is no longer active.");
      }

      const effectKey = `reply-${effectNumber++}`;
      const payload = {
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: input.text,
        channel: input.channel ?? "",
        channelProviderId: input.channelProviderId,
        replyMessageId: input.replyMessageId,
        origin: "ai_agent" as const,
      };
      const reservation = await repository.reserve({
        tenantId: context.tenant.id,
        eventId,
        provider: context.provider,
        effectKey,
        payload,
      });

      if (reservation.state === "sent") {
        return {
          messageId: reservation.messageId,
          conversationId: reservation.conversationId,
        };
      }
      if (reservation.state === "active") {
        throw new Error("Outbound message delivery is currently leased.");
      }
      if (reservation.state !== "send") {
        throw unknownOutcome();
      }

      try {
        const result = await provider.sendText(context, input);
        const recorded = await repository.markSent({
          tenantId: context.tenant.id,
          eventId,
          effectKey,
          leaseToken: reservation.leaseToken,
          messageId: result.messageId,
          conversationId: result.conversationId,
        });
        if (!recorded) {
          await repository.markUnknown({
            tenantId: context.tenant.id,
            eventId,
            effectKey,
            leaseToken: reservation.leaseToken,
            errorCode: "SEND_RESULT_NOT_PERSISTED",
          });
          throw unknownOutcome();
        }
        return result;
      } catch (error: unknown) {
        if (error instanceof KnownNonDeliveryError || isPermanentProviderRejection(error)) {
          await repository.markFailed({
            tenantId: context.tenant.id,
            eventId,
            effectKey,
            leaseToken: reservation.leaseToken,
            errorCode: error instanceof KnownNonDeliveryError
              ? error.code
              : "PROVIDER_REQUEST_REJECTED",
          });
          if (isPermanentProviderRejection(error)) {
            throw permanentProviderRejection();
          }
          throw error;
        }

        await repository.markUnknown({
          tenantId: context.tenant.id,
          eventId,
          effectKey,
          leaseToken: reservation.leaseToken,
          errorCode: error instanceof IntegrationEventProcessingError
            ? error.code
            : error instanceof Error
              ? error.name
              : typeof error,
        });
        throw unknownOutcome();
      }
    },
  };
}
