import type { RequestContext } from "../../../../context";
import type { ReservationOpportunity } from "../../../../domain/reservation/opportunity";
import type { GHLOpportunity } from "../types";
import type { IntegrationConfiguration } from "../../../../persistence/models/integration-configuration";

import { logger } from "../../../../core/logger";
import { mapOpportunityStatus } from "./status";

import {
  resolveFieldMapping,
  tryResolveFieldMapping,
} from "../../../../core/crm/field-mapping";

import {
  resolveReservationLifecycle,
} from "../../../../domain/reservation/lifecycle";

import { ReservationFields } from "../../../../canonical/reservation";
import { resolveReservationStage } from "../../../../domain/reservation/stage";

interface CustomFieldValue {
  id: string;
  field_value: string;
}

function addField(
  fields: CustomFieldValue[],
  mapping: ReturnType<typeof tryResolveFieldMapping>,
  value: unknown,
) {
  if (!mapping) {
    return;
  }

  fields.push({
    id: mapping.providerFieldId,
    field_value: value == null ? "" : String(value),
  });
}

function getConfiguration(
  context: RequestContext,
): IntegrationConfiguration {

  const configuration =
    context.tenant.integrations.crm.configuration;

  if (!configuration) {
    throw new Error(
      "CRM integration has not been configured.",
    );
  }

  return configuration;
}

export function mapReservationOpportunityToGHL(
  context: RequestContext,
  opportunity: ReservationOpportunity,
): GHLOpportunity {

  logger.debug("Building GHL opportunity payload", {
    reservationId: opportunity.reservationId,
    contactId: opportunity.contactId,
    status: opportunity.status,
  });

  const workflow =
    getConfiguration(
      context,
    ).workflow;

  const lifecycle =
  resolveReservationLifecycle(
    opportunity,
  );

const stageKey =
  resolveReservationStage(
    lifecycle,
  );

  const workflowState =
    workflow.states.find(
      (state) => state.key === stageKey,
    );

  if (!workflowState) {
    throw new Error(
      `Workflow state '${stageKey}' is not configured.`,
    );
  }

  const reservationId =
    resolveFieldMapping(
      context,
      ReservationFields.ReservationId,
    );

  const customFields: CustomFieldValue[] = [];

  // ----------------------------------------
  // Required
  // ----------------------------------------

  customFields.push({
    id: reservationId.providerFieldId,
    field_value: opportunity.reservationId ?? "",
  });

  // ----------------------------------------
  // Reservation
  // ----------------------------------------

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.OTAReferenceNumber,
    ),
    opportunity.otaReferenceNumber,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.Provider,
    ),
    opportunity.provider,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.BookingDate,
    ),
    opportunity.bookingDate,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.CheckIn,
    ),
    opportunity.checkIn,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.CheckOut,
    ),
    opportunity.checkOut,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.Nights,
    ),
    opportunity.nights,
  );

  // ----------------------------------------
  // Occupancy
  // ----------------------------------------

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.Adults,
    ),
    opportunity.adults,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.Children,
    ),
    opportunity.children,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.Infants,
    ),
    opportunity.infants,
  );

  // ----------------------------------------
  // Room
  // ----------------------------------------

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.RoomType,
    ),
    opportunity.roomType,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.RoomNumber,
    ),
    opportunity.roomNumber,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.RatePlan,
    ),
    opportunity.ratePlan,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.Package,
    ),
    opportunity.package,
  );

  // ----------------------------------------
  // Channel
  // ----------------------------------------

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.ChannelSource,
    ),
    opportunity.channelSource,
  );

  // ----------------------------------------
  // Hotel
  // ----------------------------------------

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.HotelId,
    ),
    opportunity.hotelId,
  );

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.HotelName,
    ),
    opportunity.hotelName,
  );

  // ----------------------------------------
  // Metadata
  // ----------------------------------------

  addField(
    customFields,
    tryResolveFieldMapping(
      context,
      ReservationFields.ExtractedAt,
    ),
    opportunity.extractedAt,
  );

  logger.debug("GHL opportunity payload built", {
    reservationId: opportunity.reservationId,
    customFields: customFields.length,
  });

  return {
    name: opportunity.guestName,
    contactId: opportunity.contactId,
    pipelineId: workflow.providerWorkflowId,
    pipelineStageId: workflowState.providerStateId,
    status: mapOpportunityStatus(
      opportunity.status,
    ),
    customFields,
  };
}