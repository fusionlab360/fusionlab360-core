import type { RequestContext } from "../../../../context";
import type { ReservationOpportunity } from "../../../../domain/reservation/opportunity";

import type { GHLOpportunity } from "../types";

import { resolveFieldMapping } from "../../../../core/crm/field-mapping";
import { ReservationFields } from "../../../../canonical/reservation";
export function mapReservationOpportunityToGHL(
  context: RequestContext,
  opportunity: ReservationOpportunity
): GHLOpportunity {

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

  const checkIn = resolveFieldMapping(
    context,
    ReservationFields.CheckIn
  );

  const checkOut = resolveFieldMapping(
    context,
    ReservationFields.CheckOut
  );



  return {
    name: opportunity.guestName,

    contactId: opportunity.contactId,

    pipelineId: opportunity.pipelineId,

    pipelineStageId: opportunity.pipelineStageId,

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
        id: checkIn.providerFieldId,
        field_value: opportunity.checkIn ?? "",
      },
      {
        id: checkOut.providerFieldId,
        field_value: opportunity.checkOut ?? "",
      },
  
    ],
  };
}