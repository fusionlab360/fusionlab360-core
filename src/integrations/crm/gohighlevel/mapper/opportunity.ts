import type { RequestContext } from "../../../../context";
import type { ReservationOpportunity } from "../../../../domain/reservation/opportunity";

import type { GHLOpportunity } from "../types";

import { resolveFieldMapping } from "../../../../core/crm/field-mapping";
import { ReservationFields } from "../../../../canonical/reservation";
import { resolveReservationStage } from "../../../../domain/reservation/stage";

export function mapReservationOpportunityToGHL(
  context: RequestContext,
  opportunity: ReservationOpportunity
): GHLOpportunity {
  const workflow =
    context.tenant.integrations.crm.configuration.workflow;

  const stageKey = resolveReservationStage(opportunity);

  const workflowState = workflow.states.find(
    (state) => state.key === stageKey,
  );

  if (!workflowState) {
    throw new Error(
      `Workflow state '${stageKey}' is not configured.`,
    );
  }

  const reservationId = resolveFieldMapping(
    context,
    ReservationFields.ReservationId
  );

  const provider = resolveFieldMapping(
    context,
    ReservationFields.Provider
  );

  const roomType = resolveFieldMapping(
    context,
    ReservationFields.RoomType
  );

  const roomNumber = resolveFieldMapping(
    context,
    ReservationFields.RoomNumber
  );

  const checkIn = resolveFieldMapping(
    context,
    ReservationFields.CheckIn
  );

  const checkOut = resolveFieldMapping(
    context,
    ReservationFields.CheckOut
  );

  const adults = resolveFieldMapping(
    context,
    ReservationFields.Adults
  );

  const children = resolveFieldMapping(
    context,
    ReservationFields.Children
  );

  const channelSource = resolveFieldMapping(
    context,
    ReservationFields.ChannelSource
  );

  const paymentStatus = resolveFieldMapping(
    context,
    ReservationFields.PaymentStatus
  );

  const bookingDate = resolveFieldMapping(
    context,
    ReservationFields.BookingDate
  );

  return {
    name: opportunity.guestName,

    contactId: opportunity.contactId,

    // Generic workflow translated to GHL pipeline
    pipelineId: workflow.providerWorkflowId,

    // Workflow stage resolved from reservation status
    pipelineStageId: workflowState.providerStateId,

    status: opportunity.status,

    customFields: [
      {
        id: reservationId.providerFieldId,
        field_value: opportunity.reservationId ?? "",
      },
      {
        id: provider.providerFieldId,
        field_value: opportunity.provider ?? "",
      },
      {
        id: roomType.providerFieldId,
        field_value: opportunity.roomType ?? "",
      },
      {
        id: roomNumber.providerFieldId,
        field_value: opportunity.roomNumber ?? "",
      },
      {
        id: checkIn.providerFieldId,
        field_value: opportunity.checkIn ?? "",
      },
      {
        id: checkOut.providerFieldId,
        field_value: opportunity.checkOut ?? "",
      },
      {
        id: adults.providerFieldId,
        field_value: opportunity.adults?.toString() ?? "",
      },
      {
        id: children.providerFieldId,
        field_value: opportunity.children?.toString() ?? "",
      },
      {
        id: channelSource.providerFieldId,
        field_value: opportunity.channelSource ?? "",
      },
      {
        id: paymentStatus.providerFieldId,
        field_value: opportunity.paymentStatus ?? "",
      },
      {
        id: bookingDate.providerFieldId,
        field_value: opportunity.bookingDate ?? "",
      },
    ],
  };
}