import type { RequestContext } from "../../../../context";
import type { ReservationOpportunity } from "../../../../domain/reservation/opportunity";
import type { GHLOpportunity } from "../types";

import { logger } from "../../../../core/logger";
import { mapOpportunityStatus } from "./status";

import {
  resolveFieldMapping,
  tryResolveFieldMapping,
} from "../../../../core/crm/field-mapping";

import { ReservationFields } from "../../../../canonical/reservation";
import { resolveReservationStage } from "../../../../domain/reservation/stage";

export function mapReservationOpportunityToGHL(
  context: RequestContext,
  opportunity: ReservationOpportunity
): GHLOpportunity {
  logger.debug("Building GHL opportunity payload", {
    reservationId: opportunity.reservationId,
    contactId: opportunity.contactId,
    status: opportunity.status,
  });

  const workflow = context.tenant.integrations.crm.configuration.workflow;

  const stageKey = resolveReservationStage(opportunity);

  const workflowState = workflow.states.find(
    (state) => state.key === stageKey
  );

  if (!workflowState) {
    throw new Error(
      `Workflow state '${stageKey}' is not configured.`
    );
  }

  //
  // REQUIRED
  //

  const reservationId = resolveFieldMapping(
    context,
    ReservationFields.ReservationId
  );

  //
  // OPTIONAL
  //

  const provider = tryResolveFieldMapping(
    context,
    ReservationFields.Provider
  );

  const roomType = tryResolveFieldMapping(
    context,
    ReservationFields.RoomType
  );

  const roomNumber = tryResolveFieldMapping(
    context,
    ReservationFields.RoomNumber
  );

  const checkIn = tryResolveFieldMapping(
    context,
    ReservationFields.CheckIn
  );

  const checkOut = tryResolveFieldMapping(
    context,
    ReservationFields.CheckOut
  );

  const adults = tryResolveFieldMapping(
    context,
    ReservationFields.Adults
  );

  const children = tryResolveFieldMapping(
    context,
    ReservationFields.Children
  );

  const channelSource = tryResolveFieldMapping(
    context,
    ReservationFields.ChannelSource
  );

  const paymentStatus = tryResolveFieldMapping(
    context,
    ReservationFields.PaymentStatus
  );

  const bookingDate = tryResolveFieldMapping(
    context,
    ReservationFields.BookingDate
  );

  const payload: GHLOpportunity = {
    name: opportunity.guestName,

    contactId: opportunity.contactId,

    pipelineId: workflow.providerWorkflowId,

    pipelineStageId: workflowState.providerStateId,

    status: mapOpportunityStatus(opportunity.status),

    customFields: [
      {
        id: reservationId.providerFieldId,
        field_value: opportunity.reservationId ?? "",
      },

      ...(provider
        ? [{
            id: provider.providerFieldId,
            field_value: opportunity.provider ?? "",
          }]
        : []),

      ...(roomType
        ? [{
            id: roomType.providerFieldId,
            field_value: opportunity.roomType ?? "",
          }]
        : []),

      ...(roomNumber
        ? [{
            id: roomNumber.providerFieldId,
            field_value: opportunity.roomNumber ?? "",
          }]
        : []),

      ...(checkIn
        ? [{
            id: checkIn.providerFieldId,
            field_value: opportunity.checkIn ?? "",
          }]
        : []),

      ...(checkOut
        ? [{
            id: checkOut.providerFieldId,
            field_value: opportunity.checkOut ?? "",
          }]
        : []),

      ...(adults
        ? [{
            id: adults.providerFieldId,
            field_value: opportunity.adults?.toString() ?? "",
          }]
        : []),

      ...(children
        ? [{
            id: children.providerFieldId,
            field_value: opportunity.children?.toString() ?? "",
          }]
        : []),

      ...(channelSource
        ? [{
            id: channelSource.providerFieldId,
            field_value: opportunity.channelSource ?? "",
          }]
        : []),

      ...(paymentStatus
        ? [{
            id: paymentStatus.providerFieldId,
            field_value: opportunity.paymentStatus ?? "",
          }]
        : []),

      ...(bookingDate
        ? [{
            id: bookingDate.providerFieldId,
            field_value: opportunity.bookingDate ?? "",
          }]
        : []),
    ],
  };

  logger.debug("GHL opportunity payload created", payload);

  return payload;
}