import type { ReservationPayload } from "../../../domain/reservation/types";
import type {
  STAAHConnectionContext,
  STAAHMockProperty,
  STAAHMockReservation,
  STAAHResourceMapping,
} from "./contracts";

export class STAAHReservationNormalizationError extends Error {
  constructor(readonly reason: "invalid_property" | "invalid_reservation" | "mapping_invalid") {
    super("Synthetic reservation could not be normalized.");
    this.name = "STAAHReservationNormalizationError";
  }
}

export function buildDefaultSTAAHResourceMappings(
  context: STAAHConnectionContext,
  property: STAAHMockProperty,
): STAAHResourceMapping[] {
  const identity = {
    tenantId: context.tenantId,
    integrationId: context.integrationId,
    provider: "staah" as const,
    providerPropertyId: property.providerPropertyId,
  };
  return [
    {
      ...identity,
      resourceType: "property",
      providerResourceId: property.providerPropertyId,
      canonicalResourceId: `mock-canonical-property:${property.providerPropertyId}`,
    },
    ...property.rooms.map((room) => ({
      ...identity,
      resourceType: "room" as const,
      providerResourceId: room.providerRoomId,
      canonicalResourceId: `mock-canonical-room:${property.providerPropertyId}:${room.providerRoomId}`,
    })),
    ...property.ratePlans.map((ratePlan) => ({
      ...identity,
      resourceType: "rate_plan" as const,
      providerResourceId: ratePlan.providerRatePlanId,
      canonicalResourceId: `mock-canonical-rate:${property.providerPropertyId}:${ratePlan.providerRatePlanId}`,
    })),
  ];
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function findMapping(
  mappings: readonly STAAHResourceMapping[],
  context: STAAHConnectionContext,
  propertyId: string,
  resourceType: STAAHResourceMapping["resourceType"],
  providerResourceId: string,
): string {
  const matches = mappings.filter((mapping) =>
    mapping.tenantId === context.tenantId &&
    mapping.integrationId === context.integrationId &&
    mapping.provider === "staah" &&
    mapping.providerPropertyId === propertyId &&
    mapping.resourceType === resourceType &&
    mapping.providerResourceId === providerResourceId,
  );
  if (matches.length !== 1 || !matches[0]?.canonicalResourceId.trim()) {
    throw new STAAHReservationNormalizationError("mapping_invalid");
  }
  return matches[0].canonicalResourceId;
}

export function normalizeSTAAHReservation(
  context: STAAHConnectionContext,
  property: STAAHMockProperty,
  mappings: readonly STAAHResourceMapping[],
  source: STAAHMockReservation,
): ReservationPayload {
  if (source.providerPropertyId !== property.providerPropertyId) {
    throw new STAAHReservationNormalizationError("invalid_property");
  }
  if (
    !source.providerReservationId.trim() ||
    !Number.isSafeInteger(source.revision) || source.revision < 0 ||
    !validCalendarDate(source.checkIn) ||
    !validCalendarDate(source.checkOut) ||
    source.checkOut <= source.checkIn ||
    !source.firstName.trim() ||
    !source.lastName.trim() ||
    !Number.isFinite(source.totalAmount) || source.totalAmount < 0 ||
    !source.currency.trim() ||
    !Number.isFinite(Date.parse(source.modifiedAt)) ||
    (source.status !== "CONFIRMED" && source.status !== "CANCELLED")
  ) {
    throw new STAAHReservationNormalizationError("invalid_reservation");
  }

  const propertyId = findMapping(
    mappings, context, property.providerPropertyId, "property", property.providerPropertyId,
  );
  const roomType = findMapping(
    mappings, context, property.providerPropertyId, "room", source.providerRoomId,
  );
  const ratePlan = findMapping(
    mappings, context, property.providerPropertyId, "rate_plan", source.providerRatePlanId,
  );

  return {
    provider: "staah",
    reservationId: source.providerReservationId,
    status: source.status,
    firstName: source.firstName,
    lastName: source.lastName,
    fullName: `${source.firstName} ${source.lastName}`,
    ...(source.email ? { email: source.email } : {}),
    checkIn: source.checkIn,
    checkOut: source.checkOut,
    modifiedAt: source.modifiedAt,
    roomType,
    ratePlan,
    totalAmount: source.totalAmount,
    currency: source.currency,
    hotelId: propertyId,
    hotelName: property.name,
  };
}
