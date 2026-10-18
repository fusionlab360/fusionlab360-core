import type { Context } from "hono";

import type {
  AppBindings,
  AppVariables,
} from "../../config/app";

import {
  createIntegrationContext,
} from "../../context/integration";

import type {
  BookingType,
  BookingAvailabilityRequest,
  CreateBookingRequest,
} from "../../core/booking";

import {
  listBookingOfferings,
  getBookingAvailability,
  createBooking,
  supportsBookingType,
} from "./service";

import {
  isTenantFeatureEnabled,
} from "../features/tenant-feature-service";

import type {
  TenantFeatureKey,
} from "../features/tenant-feature-service";

import {
  getConfiguredGHLRentalsBookingPageUrl,
} from "./rentals-booking-page";

type BookingContext = Context<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>;

function parseBookingDate(
  value: string,
): number | null {
  const normalized = value.trim();

  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
      normalized,
    );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const calendarDate = new Date(
    Date.UTC(year, month - 1, day),
  );

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  const timestamp = Date.parse(normalized);

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}

function validateBookingDateRange(
  start: string,
  end: string,
  requireDateTime = false,
): string | null {
  if (
    requireDateTime &&
    (!start.includes("T") || !end.includes("T"))
  ) {
    return (
      "Appointment start and end must include a time " +
      "and timezone offset."
    );
  }

  const startTimestamp = parseBookingDate(start);

  if (startTimestamp === null) {
    return (
      "start must be a valid ISO date or date-time. " +
      "Date-times must include a timezone offset."
    );
  }

  const endTimestamp = parseBookingDate(end);

  if (endTimestamp === null) {
    return (
      "end must be a valid ISO date or date-time. " +
      "Date-times must include a timezone offset."
    );
  }

  if (endTimestamp <= startTimestamp) {
    return "end must be later than start.";
  }

  return null;
}

function getIntegrationContext(
  c: BookingContext,
) {
  const requestContext = c.get("context");

  return createIntegrationContext(
    requestContext.tenant,
    requestContext.tenant.integrations.crm.provider,
    requestContext.integrationRuntime,
  );
}

type BookingContextResolution =
  | {
      allowed: true;
      context: ReturnType<typeof createIntegrationContext>;
    }
  | {
      allowed: false;
      status: 403 | 501 | 503;
      message: string;
    };

async function resolveEnabledBookingContext(
  c: BookingContext,
  type: BookingType,
): Promise<BookingContextResolution> {
  const tenantId = c.get("context").tenant.id;

  const featureKey: TenantFeatureKey =
    type === "appointment"
      ? "booking_appointment"
      : "booking_accommodation";

  let enabled: boolean;

  try {
    enabled = await isTenantFeatureEnabled(
      c.env.DB,
      tenantId,
      featureKey,
    );
  } catch {
    console.error(
      "Failed to verify tenant booking feature setting.",
      {
        tenantId,
        featureKey,
      },
    );

    return {
      allowed: false,
      status: 503,
      message:
        "Booking feature configuration could not be verified.",
    };
  }

  if (!enabled) {
    return {
      allowed: false,
      status: 403,
      message:
        type === "appointment"
          ? "Appointment booking is disabled for this tenant."
          : "Accommodation booking is disabled for this tenant.",
    };
  }

  let context: ReturnType<typeof createIntegrationContext>;

  try {
    context = getIntegrationContext(c);
  } catch {
    console.error(
      "Failed to resolve tenant booking integration.",
      {
        tenantId,
        bookingType: type,
      },
    );

    return {
      allowed: false,
      status: 503,
      message:
        "Booking integration configuration could not be verified.",
    };
  }

  try {
    const supported = await supportsBookingType(
      context,
      type,
    );

    if (!supported) {
      return {
        allowed: false,
        status: 501,
        message:
          "The configured booking provider does not support this booking type.",
      };
    }
  } catch {
    console.error(
      "Failed to verify booking provider capability.",
      {
        tenantId,
        bookingType: type,
      },
    );

    return {
      allowed: false,
      status: 503,
      message:
        "Booking provider capability could not be verified.",
    };
  }

  return {
    allowed: true,
    context,
  };
}

export async function getAccommodationBookingPageController(
  c: BookingContext,
) {
  const requestContext = c.get("context");
  const tenant = requestContext.tenant;
  const tenantId = tenant.id;

  let enabled: boolean;

  try {
    enabled = await isTenantFeatureEnabled(
      c.env.DB,
      tenantId,
      "booking_accommodation",
    );
  } catch {
    console.error(
      "Failed to verify accommodation booking setting.",
      { tenantId },
    );

    return c.json(
      {
        success: false,
        message:
          "Accommodation booking configuration could not be verified.",
      },
      503,
    );
  }

  if (!enabled) {
    return c.json(
      {
        success: false,
        message:
          "Accommodation booking is disabled for this tenant.",
      },
      403,
    );
  }

  if (tenant.integrations.crm.provider !== "gohighlevel") {
    return c.json(
      {
        success: false,
        message:
          "The configured CRM integration does not support the GHL Rentals handoff.",
      },
      409,
    );
  }

  let bookingUrl: string | null;

  try {
    bookingUrl =
      await getConfiguredGHLRentalsBookingPageUrl(
        c.env.DB,
        tenant,
      );
  } catch (error: unknown) {
    console.error(
      "Failed to load accommodation booking-page configuration.",
      {
        tenantId,
        errorName:
          error instanceof Error
            ? error.name
            : "UnknownError",
      },
    );

    return c.json(
      {
        success: false,
        message:
          "Accommodation booking configuration could not be loaded.",
      },
      503,
    );
  }

  if (!bookingUrl) {
    return c.json(
      {
        success: false,
        message:
          "The GHL Rentals booking page has not been configured for this tenant.",
      },
      409,
    );
  }

  return c.json({
    success: true,
    bookingType: "accommodation",
    bookingMode: "external_rentals",
    bookingUrl,
  });
}

/*
 * --------------------------------------------------
 * GET /booking/offerings
 * --------------------------------------------------
 *
 * Example:
 *
 * GET /booking/offerings?type=appointment
 */
export async function listBookingOfferingsController(
  c: BookingContext,
) {
  const type = c.req.query(
    "type",
  ) as BookingType | undefined;

  if (
    type !== "appointment" &&
    type !== "accommodation"
  ) {
    return c.json(
      {
        success: false,
        message: "type must be appointment or accommodation.",
      },
      400,
    );
  }

 const bookingContext =
  await resolveEnabledBookingContext(c, type);

if (!bookingContext.allowed) {
  return c.json(
    {
      success: false,
      message: bookingContext.message,
    },
    bookingContext.status,
  );
}

const offerings = await listBookingOfferings(
  bookingContext.context,
  type,
);

  return c.json({
    success: true,
    type,
    offerings,
  });
}

/*
 * --------------------------------------------------
 * POST /booking/availability
 * --------------------------------------------------
 */
export async function getBookingAvailabilityController(
  c: BookingContext,
) {
  const body =
    await c.req.json<BookingAvailabilityRequest>();

  if (
    body.type !== "appointment" &&
    body.type !== "accommodation"
  ) {
    return c.json(
      {
        success: false,
        message: "type must be appointment or accommodation.",
      },
      400,
    );
  }

  if (
    typeof body.offeringId !== "string" ||
    !body.offeringId.trim()
  ) {
    return c.json(
      {
        success: false,
        message: "offeringId is required.",
      },
      400,
    );
  }

  if (
    typeof body.start !== "string" ||
    !body.start.trim()
  ) {
    return c.json(
      {
        success: false,
        message: "start is required.",
      },
      400,
    );
  }

  if (
    typeof body.end !== "string" ||
    !body.end.trim()
  ) {
    return c.json(
      {
        success: false,
        message: "end is required.",
      },
      400,
    );
  }

  // Validate dates before resolving integration context.
  const dateRangeError = validateBookingDateRange(
    body.start,
    body.end,
    body.type === "appointment",
  );

  if (dateRangeError) {
    return c.json(
      {
        success: false,
        message: dateRangeError,
      },
      400,
    );
  }

  const bookingContext =
  await resolveEnabledBookingContext(c, body.type);

if (!bookingContext.allowed) {
  return c.json(
    {
      success: false,
      message: bookingContext.message,
    },
    bookingContext.status,
  );
}

const slots = await getBookingAvailability(
  bookingContext.context,
  body,
);

  return c.json({
    success: true,
    request: body,
    slots,
  });
}

/*
 * --------------------------------------------------
 * POST /booking
 * --------------------------------------------------
 */
export async function createBookingController(
  c: BookingContext,
) {
  const body =
    await c.req.json<CreateBookingRequest>();

  if (
    body.type !== "appointment" &&
    body.type !== "accommodation"
  ) {
    return c.json(
      {
        success: false,
        message: "type must be appointment or accommodation.",
      },
      400,
    );
  }

  if (
    typeof body.offeringId !== "string" ||
    !body.offeringId.trim()
  ) {
    return c.json(
      {
        success: false,
        message: "offeringId is required.",
      },
      400,
    );
  }

  if (
    typeof body.customerId !== "string" ||
    !body.customerId.trim()
  ) {
    return c.json(
      {
        success: false,
        message: "customerId is required.",
      },
      400,
    );
  }

  if (
    typeof body.start !== "string" ||
    !body.start.trim()
  ) {
    return c.json(
      {
        success: false,
        message: "start is required.",
      },
      400,
    );
  }

  if (
    typeof body.end !== "string" ||
    !body.end.trim()
  ) {
    return c.json(
      {
        success: false,
        message: "end is required.",
      },
      400,
    );
  }

  // Validate dates before resolving integration context.
  const dateRangeError = validateBookingDateRange(
    body.start,
    body.end,
    body.type === "appointment",
  );

  if (dateRangeError) {
    return c.json(
      {
        success: false,
        message: dateRangeError,
      },
      400,
    );
  }

  const bookingContext =
  await resolveEnabledBookingContext(c, body.type);

if (!bookingContext.allowed) {
  return c.json(
    {
      success: false,
      message: bookingContext.message,
    },
    bookingContext.status,
  );
}

const booking = await createBooking(
  bookingContext.context,
  body,
);
  return c.json({
    success: true,
    booking,
  });
}