import type {
  AIProvider,
} from "../../core/ai";


import type {
  MessagingMessage,
} from "../../core/messaging";


import type {
  IntegrationContext,
} from "../../context/integration";


import type {
  BookingAvailabilitySlot,
  BookingType,
} from "../../core/booking";


import {
  listBookingOfferings,
  getBookingAvailability,
  createBooking,
  getBooking,
  updateBooking,
  cancelBooking,
  supportsBookingType,
} from "./service";


import {
  extractBookingIntent,
  type BookingIntent,
} from "./booking-intent";


import {
  AIBookingSessionRepository,
  type AIBookingSession,
  type AIBookingSessionStatus,
} from "../../persistence/repositories/ai-booking-session-repository";


/*
 * --------------------------------------------------
 * Input
 * --------------------------------------------------
 */

export interface ProcessAIBookingInput {

  db:
    D1Database;

  context:
    IntegrationContext;

  ai:
    AIProvider;

  history:
    MessagingMessage[];

  currentMessage:
    string;

  occurredAt:
    string;

  conversationId:
    string;

  customerId:
    string;

  timezone?:
    string;

  
}


/*
 * --------------------------------------------------
 * Output
 * --------------------------------------------------
 */

export interface AIBookingResult {

  handled:
    boolean;

  state:
    AIBookingSessionStatus |
    null;

  intent:
    BookingIntent;

  message:
    string;

  session:
    AIBookingSession |
    null;

  actionExecuted?:
    boolean;

  actionResult?:
    | "none"
    | "success"
    | "failed";

  booking?:
    Awaited<
      ReturnType<
        typeof createBooking
      >
    >;
}


/*
 * --------------------------------------------------
 * Default timezone
 * --------------------------------------------------
 */

const DEFAULT_TIMEZONE =
  "Asia/Kuala_Lumpur";


/*
 * --------------------------------------------------
 * Helpers
 * --------------------------------------------------
 */


/*
 * Parse persisted session data.
 */
function readSessionData(
  session:
    AIBookingSession |
    null,
):
  Record<
    string,
    unknown
  > {

  if (
    !session?.dataJson
  ) {

    return {};
  }


  try {

    const parsed =
      JSON.parse(
        session.dataJson,
      );


    if (
      parsed &&
      typeof parsed ===
        "object"
    ) {

      return parsed;
    }

  } catch {

    /*
     * Ignore malformed historical session data.
     */
  }


  return {};
}



/*
 * Merge arbitrary booking data into session.
 */
function buildDataJson(
  session:
    AIBookingSession |
    null,

  intent:
    BookingIntent,
):
  string {

  const data =
    readSessionData(
      session,
    );


  if (
    intent.offeringQuery
  ) {

    data.offeringQuery =
      intent.offeringQuery;
  }


  if (
    intent.branchQuery
  ) {

    data.branchQuery =
      intent.branchQuery;
  }


  if (
    intent.resourceQuery
  ) {

    data.resourceQuery =
      intent.resourceQuery;
  }


  if (
    intent.date
  ) {

    data.date =
      intent.date;
  }


  if (
    intent.time
  ) {

    data.time =
      intent.time;
  }


  if (
    intent.start
  ) {

    data.start =
      intent.start;
  }


  if (
    intent.end
  ) {

    data.end =
      intent.end;
  }

  /*
 * ----------------------------------------------
 * Accommodation guest/unit data
 * ----------------------------------------------
 *
 * These fields are optional for appointments but
 * become important for accommodation bookings.
 *
 * A null value means "not supplied in this message",
 * so an existing confirmed conversational value is
 * preserved.
 *
 * Zero is valid and must not be treated as missing.
 * ----------------------------------------------
 */

if (
  intent.adults !==
  null
) {

  data.adults =
    intent.adults;
}


if (
  intent.children !==
  null
) {

  data.children =
    intent.children;
}


if (
  intent.quantity !==
  null
) {

  data.quantity =
    intent.quantity;
}


  return JSON.stringify(
    data,
  );
}



/*
 * Get a stored value.
 */
function getStoredString(
  session:
    AIBookingSession |
    null,

  key:
    string,
):
  string |
  null {

  const data =
    readSessionData(
      session,
    );


  const value =
    data[key];


  return typeof value ===
    "string"

    ? value

    : null;
}

/*
 * --------------------------------------------------
 * Get stored numeric value
 * --------------------------------------------------
 */

function getStoredNumber(
  session:
    AIBookingSession |
    null,

  key:
    string,
):
  number |
  null {

  const data =
    readSessionData(
      session,
    );


  const value =
    data[key];


  if (
    typeof value ===
      "number" &&
    Number.isFinite(
      value,
    )
  ) {

    return value;
  }


  if (
    typeof value ===
      "string"
  ) {

    const parsed =
      Number(
        value,
      );


    if (
      Number.isFinite(
        parsed,
      )
    ) {

      return parsed;
    }
  }


  return null;
}


/*
 * --------------------------------------------------
 * Save session
 * --------------------------------------------------
 */

async function saveSession(
  repository:
    AIBookingSessionRepository,

  session:
    AIBookingSession,
):
  Promise<
    AIBookingSession
  > {

  await repository.upsert(
    session,
  );


  return session;
}


/*
 * --------------------------------------------------
 * Reset booking session
 * --------------------------------------------------
 */

function createFreshSession(
  context:
    IntegrationContext,

  conversationId:
    string,

  bookingType:
    BookingType,
):
  AIBookingSession {

  const now =
    new Date().toISOString();


  return {

    tenantId:
      context.tenant.id,

    provider:
      context.provider,

    conversationId,

    status:
      "collecting",

    bookingType,

    offeringId:
      null,

    resourceId:
      null,

    startAt:
      null,

    endAt:
      null,

    adults:
      null,

    children:
      null,

    quantity:
      null,

    pendingSlotsJson:
      null,

    dataJson:
      JSON.stringify({}),

    createdAt:
      now,

    updatedAt:
      now,
  };
}


/*
 * --------------------------------------------------
 * Resolve offering
 * --------------------------------------------------
 */

async function resolveOffering(
  context:
    IntegrationContext,

  bookingType:
    BookingType,

  offeringQuery:
    string |
    null,

  branchQuery:
    string |
    null,
) {

  const offerings =
    await listBookingOfferings(
      context,

      bookingType,
    );


  if (
    offerings.length ===
    0
  ) {

    return {

      offering:
        null,

      offerings,
    };
  }


  const queryParts:
    string[] =
    [];


  if (
    offeringQuery
  ) {

    queryParts.push(
      offeringQuery,
    );
  }


  if (
    branchQuery
  ) {

    queryParts.push(
      branchQuery,
    );
  }


  const query =
    queryParts
      .join(
        " ",
      )
      .trim()
      .toLowerCase();


  if (
    !query
  ) {

    return {

      offering:
        offerings.length ===
          1

          ? offerings[0]

          : null,

      offerings,
    };
  }


  /*
   * Exact full-name match.
   */

  const exact =
    offerings.filter(
      (
        offering,
      ) =>
        offering.name
          .trim()
          .toLowerCase() ===
        query,
    );


  if (
    exact.length ===
    1
  ) {

    return {

      offering:
        exact[0],

      offerings,
    };
  }


  /*
   * Token/partial match.
   */

  const matching =
    offerings.filter(
      (
        offering,
      ) => {

        const name =
          offering.name
            .trim()
            .toLowerCase();


        return (
          name.includes(
            query,
          ) ||

          query
            .split(
              /\s+/,
            )
            .filter(
              Boolean,
            )
            .every(
              (
                token,
              ) =>
                name.includes(
                  token,
                ),
            )
        );
      },
    );


  if (
    matching.length ===
    1
  ) {

    return {

      offering:
        matching[0],

      offerings,
    };
  }


  return {

    offering:
      null,

    offerings,
  };
}


/*
 * --------------------------------------------------
 * Offering selection prompt
 * --------------------------------------------------
 */

function buildOfferingPrompt(
  offerings:
    Awaited<
      ReturnType<
        typeof listBookingOfferings
      >
    >,

  bookingType:
    BookingType,
):
  string {

  const isAccommodation =
    bookingType ===
    "accommodation";


  if (
    offerings.length ===
    0
  ) {

    return (
      isAccommodation
        ? "I’m sorry, but I don't have any accommodation options available right now. A member of the team can assist you."
        : "I’m sorry, but I don't have any appointment options available right now. A member of the team can assist you."
    );
  }


  if (
    offerings.length ===
    1
  ) {

    return (
      isAccommodation
        ? `Sure, I can help with ${offerings[0].name}. What check-in date would you like?`
        : `Sure, I can help with ${offerings[0].name}. What date would you like to book?`
    );
  }


  const lines =
    offerings
      .slice(
        0,
        10,
      )
      .map(
        (
          offering,
          index,
        ) =>
          `${index + 1}. ${offering.name}`,
      );


  return (
    isAccommodation
      ? "Sure, I can help with that. Which accommodation would you like to book?\n\n" +
        lines.join(
          "\n",
        )
      : "Sure, I can help with that. Which appointment would you like to book?\n\n" +
        lines.join(
          "\n",
        )
  );
}

/*
 * --------------------------------------------------
 * Date prompt
 * --------------------------------------------------
 */

function buildDatePrompt():
  string {

  return (
    "What date would you like to book the appointment?"
  );
}

/*
 * --------------------------------------------------
 * Accommodation prompts
 * --------------------------------------------------
 */

function buildAccommodationCheckInPrompt():
  string {

  return (
    "What check-in date would you like?"
  );
}


function buildAccommodationCheckOutPrompt():
  string {

  return (
    "What check-out date would you like?"
  );
}


/*
 * --------------------------------------------------
 * Time prompt
 * --------------------------------------------------
 */

function buildTimePrompt():
  string {

  return (
    "What time would you prefer?"
  );
}


/*
 * --------------------------------------------------
 * Convert local date/time to ISO
 * --------------------------------------------------
 */

function localDateTimeToISO(
  date:
    string,

  time:
    string,

  timezone:
    string,
):
  string {

  /*
   * Current tenant default.
   *
   * Malaysia has UTC+08:00.
   */

  if (
    timezone ===
    "Asia/Kuala_Lumpur"
  ) {

    const result =
      new Date(
        `${date}T${time}:00+08:00`,
      );


    if (
      Number.isNaN(
        result.getTime(),
      )
    ) {

      throw new Error(
        `Invalid local appointment date/time: ${date} ${time}`,
      );
    }


    return result.toISOString();
  }


  /*
   * Fallback.
   */

  const result =
    new Date(
      `${date}T${time}:00Z`,
    );


  if (
    Number.isNaN(
      result.getTime(),
    )
  ) {

    throw new Error(
      `Invalid appointment date/time: ${date} ${time}`,
    );
  }


  return result.toISOString();
}


/*
 * --------------------------------------------------
 * Validate accommodation quantities
 * --------------------------------------------------
 *
 * Provider-neutral validation.
 *
 * These fields represent quantities, not free-form
 * text. Reject invalid negative/fractional values
 * before they reach a PMS or channel manager.
 *
 * null means the customer has not supplied the value.
 * --------------------------------------------------
 */

function validateAccommodationQuantities(
  adults:
    number |
    null,

  children:
    number |
    null,

  quantity:
    number |
    null,
):
  string |
  null {

  const values:
    Array<{
      name:
        string;

      value:
        number |
        null;

      minimum:
        number;

      integer:
        boolean;
    }> =
    [
      {
        name:
          "adults",

        value:
          adults,

        minimum:
          0,

        integer:
          true,
      },

      {
        name:
          "children",

        value:
          children,

        minimum:
          0,

        integer:
          true,
      },

      {
        name:
          "quantity",

        value:
          quantity,

        minimum:
          1,

        integer:
          true,
      },
    ];


  for (
    const item of
      values
  ) {

    if (
      item.value ===
      null
    ) {

      continue;
    }


    if (
      !Number.isFinite(
        item.value,
      )
    ) {

      return (
        `${item.name} must be a valid number.`
      );
    }


    if (
      item.integer &&
      !Number.isInteger(
        item.value,
      )
    ) {

      return (
        `${item.name} must be a whole number.`
      );
    }


    if (
      item.value <
      item.minimum
    ) {

      return (
        item.name ===
          "quantity"

          ? "The number of rooms or units must be at least 1."

          : `${item.name} cannot be negative.`
      );
    }
  }


  return null;
}


/*
 * --------------------------------------------------
 * Accommodation date range
 * --------------------------------------------------
 *
 * Accommodation uses:
 *
 * start = check-in
 * end   = check-out
 *
 * Unlike appointments, the end is not calculated from
 * a duration and is not a same-day slot boundary.
 * --------------------------------------------------
 */

function buildAccommodationRange(
  start:
    string |
    null,

  end:
    string |
    null,
):
  {
    start:
      string;

    end:
      string;
  }
  | null {

  if (
    !start ||
    !end
  ) {

    return null;
  }


  const startDate =
    new Date(
      start,
    );

  const endDate =
    new Date(
      end,
    );


  if (
    Number.isNaN(
      startDate.getTime(),
    ) ||
    Number.isNaN(
      endDate.getTime(),
    )
  ) {

    return null;
  }


  if (
    endDate.getTime() <=
    startDate.getTime()
  ) {

    return null;
  }


  return {
    start:
      startDate.toISOString(),

    end:
      endDate.toISOString(),
  };
}

/*
 * --------------------------------------------------
 * Build day range
 * --------------------------------------------------
 */

function buildDayRange(
  date:
    string,

  timezone:
    string,
):
  {
    start:
      string;

    end:
      string;
  } {

  const current =
    new Date(
      `${date}T00:00:00Z`,
    );


  if (
    Number.isNaN(
      current.getTime(),
    )
  ) {

    throw new Error(
      `Invalid booking date: ${date}`,
    );
  }


  const next =
    new Date(
      current.getTime(),
    );


  next.setUTCDate(
    next.getUTCDate() +
    1,
  );


  const nextDate =
    next
      .toISOString()
      .slice(
        0,
        10,
      );


  if (
    timezone ===
    "Asia/Kuala_Lumpur"
  ) {

    return {

      start:
        `${date}T00:00:00+08:00`,

      end:
        `${nextDate}T00:00:00+08:00`,
    };
  }


  return {

    start:
      `${date}T00:00:00Z`,

    end:
      `${nextDate}T00:00:00Z`,
  };
}


/*
 * --------------------------------------------------
 * Format slot for customer
 * --------------------------------------------------
 */

function formatSlot(
  slot:
    BookingAvailabilitySlot,

  timezone:
    string,
):
  string {

  const start =
    new Date(
      slot.start,
    );


  if (
    Number.isNaN(
      start.getTime(),
    )
  ) {

    return slot.start;
  }


  return new Intl.DateTimeFormat(
    "en-MY",
    {
      timeZone:
        timezone,

      hour:
        "numeric",

      minute:
        "2-digit",

      hour12:
        true,
    },
  ).format(
    start,
  );
}


/*
 * --------------------------------------------------
 * Build availability response
 * --------------------------------------------------
 */

function buildAvailabilityMessage(
  slots:
    BookingAvailabilitySlot[],

  timezone:
    string,
):
  string {

  if (
    slots.length ===
    0
  ) {

    return (
      "I couldn't find an available appointment on that date. " +
      "Would you like to try another date?"
    );
  }


  const visible =
    slots.slice(
      0,
      5,
    );


  const lines =
    visible.map(
      (
        slot,
        index,
      ) =>
        `${index + 1}. ${formatSlot(
          slot,
          timezone,
        )}`,
    );


  return (
    "I found these available times:\n\n" +
    lines.join(
      "\n",
    ) +
    "\n\nWhich one would you prefer?"
  );
}


/*
 * --------------------------------------------------
 * Parse pending slots
 * --------------------------------------------------
 */

function parsePendingSlots(
  session:
    AIBookingSession,
):
  BookingAvailabilitySlot[] {

  if (
    !session.pendingSlotsJson
  ) {

    return [];
  }


  try {

    const parsed =
      JSON.parse(
        session.pendingSlotsJson,
      );


    return Array.isArray(
      parsed,
    )
      ? parsed as
          BookingAvailabilitySlot[]
      : [];

  } catch {

    return [];
  }
}


/*
 * --------------------------------------------------
 * Resolve selected slot
 * --------------------------------------------------
 */

function resolveSelectedSlot(
  session:
    AIBookingSession,

  intent:
    BookingIntent,

  timezone:
    string,
):
  BookingAvailabilitySlot |
  null {

  const slots =
    parsePendingSlots(
      session,
    );


  if (
    slots.length ===
    0
  ) {

    return null;
  }


  /*
   * Selection by number.
   */

  if (
    intent.slotNumber !==
      null
  ) {

    const index =
      Math.floor(
        intent.slotNumber,
      ) -
      1;


    if (
      index >=
        0 &&

      index <
        slots.length
    ) {

      return slots[index];
    }
  }


  /*
   * Selection by requested time.
   */

  if (
    intent.time
  ) {

    const requested =
      intent.time
        .trim()
        .toLowerCase()
        .replace(
          /\s/g,
          "",
        );


    for (
      const slot of
        slots
    ) {

      const slotDate =
        new Date(
          slot.start,
        );


      if (
        Number.isNaN(
          slotDate.getTime(),
        )
      ) {

        continue;
      }


      const twentyFourHour =
  new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:
        timezone,

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false,
    },
  )
    .format(
      slotDate,
    )
    .replace(
      /\s/g,
      "",
    );


const normalizedTwentyFourHour =
  twentyFourHour
    .replace(
      /^0(\d):/,
      "$1:",
    );


if (
  normalizedTwentyFourHour ===
  requested
) {

  return slot;
}


      const twelveHour =
        formatSlot(
          slot,
          timezone,
        )
          .toLowerCase()
          .replace(
            /\s/g,
            "",
          );


      if (
        twelveHour ===
        requested
      ) {

        return slot;
      }
    }
  }


  return null;
}


/*
 * --------------------------------------------------
 * Confirmation summary
 * --------------------------------------------------
 */

function buildConfirmationMessage(
  offeringName:
    string,

  slot:
    BookingAvailabilitySlot,

  timezone:
    string,
):
  string {

  const date =
    new Intl.DateTimeFormat(
      "en-MY",
      {
        timeZone:
          timezone,

        year:
          "numeric",

        month:
          "long",

        day:
          "numeric",
      },
    ).format(
      new Date(
        slot.start,
      ),
    );


  const time =
    formatSlot(
      slot,
      timezone,
    );


  return (
    `I have ${offeringName} available on ${date} at ${time}. ` +
    "Would you like me to book this appointment?"
  );
}

/*
 * --------------------------------------------------
 * Deterministic offering selection
 * --------------------------------------------------
 *
 * Booking choices shown by the engine must not depend
 * entirely on the LLM understanding the customer's
 * short follow-up response.
 *
 * Supports:
 *
 * 1
 * 2
 * Your Calendar
 * Respreet Kaur's Personal Calendar
 */

function resolveOfferingSelection(
  offerings:
    Awaited<
      ReturnType<
        typeof listBookingOfferings
      >
    >,

  message:
    string,
) {

  const normalized =
    message
      .trim()
      .toLowerCase();


  if (
    !normalized
  ) {

    return null;
  }


  /*
   * Numeric selection.
   *
   * "1"
   * "2"
   * "3"
   */
  if (
    /^\d+$/.test(
      normalized,
    )
  ) {

    const index =
      Number(
        normalized,
      ) -
      1;


    if (
      index >= 0 &&
      index <
        offerings.length
    ) {

      return offerings[index];
    }
  }


  /*
   * Exact calendar name.
   */
  const exact =
    offerings.filter(
      (
        offering,
      ) =>
        offering.name
          .trim()
          .toLowerCase() ===
        normalized,
    );


  if (
    exact.length ===
    1
  ) {

    return exact[0];
  }


  /*
   * Partial calendar name.
   */
  const partial =
    offerings.filter(
      (
        offering,
      ) =>
        offering.name
          .toLowerCase()
          .includes(
            normalized,
          ),
    );


  if (
    partial.length ===
    1
  ) {

    return partial[0];
  }


  /*
   * Token matching.
   *
   * "Respreet Kaur personal calendar"
   *
   * matches:
   *
   * "Respreet Kaur's Personal Calendar"
   */
  const tokens =
    normalized
      .split(
        /\s+/,
      )
      .filter(
        Boolean,
      );


  if (
    tokens.length ===
    0
  ) {

    return null;
  }


  const tokenMatches =
    offerings.filter(
      (
        offering,
      ) => {

        const name =
          offering.name
            .toLowerCase()
            .replace(
              /['’]/g,
              "",
            );


        return tokens.every(
          (
            token,
          ) =>
            name.includes(
              token,
            ),
        );
      },
    );


  if (
    tokenMatches.length ===
    1
  ) {

    return tokenMatches[0];
  }


  return null;
}

/*
 * --------------------------------------------------
 * Deterministic confirmation detection
 * --------------------------------------------------
 *
 * When the booking engine has already presented an
 * exact appointment and is waiting for confirmation,
 * simple replies such as:
 *
 * "yes"
 * "yes book it"
 * "book it"
 * "confirm"
 * "please book"
 *
 * must not depend on the LLM classifying the message
 * correctly.
 */
function isBookingConfirmationMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /[.!?,]+$/g,
        "",
      )
      .replace(
        /\s+/g,
        " ",
      );


  if (
    !normalized
  ) {

    return false;
  }


  const confirmationPhrases =
    [
      "yes",

      "yes please",

      "yes book it",

      "yes, book it",

      "book it",

      "please book",

      "please book it",

      "confirm",

      "confirmed",

      "go ahead",

      "go ahead and book",

      "that's fine",

      "that is fine",

      "that's correct",

      "that is correct",

      "proceed",

      "proceed with booking",

      "make the booking",

      "i want to book it",

      "i'd like to book it",

      "book this",

      "book this appointment",
    ];


  return confirmationPhrases.includes(
    normalized,
  );
}

function isCancellationRequestMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        " ",
      );


  if (
    !normalized
  ) {

    return false;
  }


  return (
    /\b(?:cancel|cancelled|cancellation)\s+(?:my\s+)?(?:booking|appointment|reservation)\b/i.test(
      normalized,
    ) ||

    /\b(?:please\s+)?cancel\s+(?:it|this)\b/i.test(
      normalized,
    ) ||

    /\b(?:i\s+want|i'd\s+like|i\s+need)\s+to\s+cancel\b/i.test(
      normalized,
    ) ||

    /\b(?:nak|mahu)\s+batal(?:kan)?\s+(?:tempahan|temujanji)\b/i.test(
      normalized,
    )
  );
}


function isCancellationConfirmationMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /[.!?,]+$/g,
        "",
      )
      .replace(
        /\s+/g,
        " ",
      );


  if (
    !normalized
  ) {

    return false;
  }


  const phrases =
    [

      "yes",

      "yes cancel it",

      "yes please",

      "yes please cancel",

      "cancel it",

      "cancel this",

      "please cancel",

      "please cancel it",

      "confirm cancellation",

      "go ahead",

      "go ahead and cancel",

      "proceed",

      "proceed with cancellation",

      "that's correct",

      "that is correct",

    ];


  return phrases.includes(
    normalized,
  );
}

function isCancellationDeclineMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /[.!?,]+$/g,
        "",
      )
      .replace(
        /\s+/g,
        " ",
      );

  if (
    !normalized
  ) {
    return false;
  }

  const declinePhrases =
    [
      "no",
      "no thanks",
      "no thank you",
      "don't cancel",
      "do not cancel",
      "dont cancel",
      "keep it",
      "keep my appointment",
      "leave it",
      "leave it as it is",
      "never mind",
      "nevermind",
      "not now",
      "not anymore",
      "i changed my mind",
      "nothing",
    ];

  return declinePhrases.includes(
    normalized,
  );
}

/*
 * --------------------------------------------------
 * Deterministic reschedule detection
 * --------------------------------------------------
 *
 * A confirmed appointment must not be treated as a
 * brand-new booking when the customer wants to change
 * the existing appointment.
 *
 * Examples:
 *
 * "I want to reschedule my appointment"
 * "Can I change my appointment?"
 * "I need to move my booking"
 * "Can we change the date?"
 * "Can we change the time?"
 * "I want another time for my appointment"
 * --------------------------------------------------
 */

function isRescheduleRequestMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        " ",
      );


  if (
    !normalized
  ) {

    return false;
  }


  return (
    /\b(?:reschedule|re-schedule)\b/i.test(
      normalized,
    ) &&

    /\b(?:appointment|booking|reservation|it|this)\b/i.test(
      normalized,
    )
  ) ||

  (
    /\b(?:change|move)\b/i.test(
      normalized,
    ) &&

    /\b(?:my\s+)?(?:appointment|booking|reservation)\b/i.test(
      normalized,
    )
  ) ||

  /\b(?:change|move)\s+(?:the\s+)?(?:date|time)\b/i.test(
    normalized,
  ) ||

  /\b(?:another|different)\s+(?:date|time)\b/i.test(
    normalized
  ) ||

  /\b(?:can|could|would)\s+(?:i|we)\s+(?:change|move|reschedule)\b/i.test(
    normalized,
  ) ||

  /\b(?:nak|mahu)\s+(?:tukar|ubah)\s+(?:tarikh|masa|temujanji|tempahan)\b/i.test(
    normalized,
  ) ||

  /(改期|更改时间|更改预约)/u.test(
    normalized,
  );
}

/*
 * --------------------------------------------------
 * Deterministic reschedule confirmation
 * --------------------------------------------------
 *
 * This is evaluated only when the booking engine has
 * already asked the customer to confirm a requested
 * reschedule.
 *
 * Examples:
 *
 * "yes"
 * "yes please"
 * "confirm"
 * "go ahead"
 * "please do it"
 * --------------------------------------------------
 */

function isRescheduleConfirmationMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /[.!?,]+$/g,
        "",
      )
      .replace(
        /\s+/g,
        " ",
      );


  if (
    !normalized
  ) {

    return false;
  }


  const phrases =
    [

      "yes", "yes please", "confirm", "confirmed",

      "go ahead", "please do it", "do it", "yes change it",

      "yes please change it",  "yes reschedule it",

      "yes please reschedule", "go ahead and change it",

      "go ahead and reschedule", "proceed", "proceed with the change",

      "proceed with the reschedule", "that's correct", "that is correct",

    ];


  return phrases.includes(
    normalized,
  );
}


/*
 * --------------------------------------------------
 * Deterministic restart protection
 * --------------------------------------------------
 *
 * A confirmed booking must never be reset simply
 * because the LLM interprets a later message as
 * "start".
 *
 * A new booking requires an explicit new-booking
 * statement.
 */
function isExplicitNewBookingMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        " ",
      );


  const phrases =
    [
      "new booking",

      "make a new booking",

      "book another appointment",

      "another appointment",

      "book another",

      "i want another appointment",

      "i need another appointment",

      "start a new booking",

      "new appointment",
    ];


  return phrases.includes(
    normalized,
  );
}

/*
 * --------------------------------------------------
 * Detect availability refinement requests
 * --------------------------------------------------
 *
 * These are not slot selections.
 *
 * Examples:
 *
 * "Do you have evening time?"
 * "Any evening appointments?"
 * "What about morning?"
 * "Do you have something later?"
 * "Anything earlier?"
 */

function isAvailabilityRefinementMessage(
  message:
    string,
):
  boolean {

  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        " ",
      );


  return (
    /\bevening\b/.test(
      normalized,
    ) &&

    !/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/.test(
      normalized,
    )
  );

}

/*
 * --------------------------------------------------
 * Deterministic pending-slot selection
 * --------------------------------------------------
 *
 * When the Core has already displayed available
 * appointment slots, short replies must be resolved
 * against those exact slots.
 *
 * Examples:
 *
 * "1"
 * "2"
 * "9:00 am"
 * "10:30"
 */
function resolvePendingSlotSelection(
  session:
    AIBookingSession,

  message:
    string,

  timezone:
    string,
):
  BookingAvailabilitySlot |
  null {

  const slots =
    parsePendingSlots(
      session,
    );


  if (
    slots.length ===
    0
  ) {

    return null;
  }


  const normalized =
    message
      .trim()
      .toLowerCase()
      .replace(
        /\s+/g,
        " ",
      );


  if (
    !normalized
  ) {

    return null;
  }


  /*
   * Numeric selection.
   */
  if (
    /^\d+$/.test(
      normalized,
    )
  ) {

    const index =
      Number(
        normalized,
      ) -
      1;


    if (
      index >= 0 &&
      index <
        slots.length
    ) {

      return slots[index];
    }
  }


  /*
   * Time selection.
   */
  const compactTime =
    normalized.replace(
      /\s/g,
      "",
    );


  for (
    const slot of
      slots
  ) {

    const slotDate =
      new Date(
        slot.start,
      );


    if (
      Number.isNaN(
        slotDate.getTime(),
      )
    ) {

      continue;
    }


    const twentyFourHour =
  new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:
        timezone,

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false,
    },
  )
    .format(
      slotDate,
    )
    .replace(
      /\s/g,
      "",
    );


const normalizedTwentyFourHour =
  twentyFourHour
    .replace(
      /^0(\d):/,
      "$1:",
    );


if (
  normalizedTwentyFourHour ===
  compactTime
) {

  return slot;
}

    const twelveHour =
      formatSlot(
        slot,

        timezone,
      )
        .toLowerCase()
        .replace(
          /\s/g,
          "",
        );


    if (
      twelveHour ===
      compactTime
    ) {

      return slot;
    }
  }


  return null;
}

function isAuthorizedBookingExecution(
  session:
    AIBookingSession |
    null,

  intent:
    BookingIntent,

  currentMessage:
    string,
):
  boolean {

  if (
    !session ||
    session.status !==
      "awaiting_confirmation"
  ) {
    return false;
  }

  if (
    intent.action !==
      "confirm"
  ) {
    return false;
  }

  if (
    !session.offeringId ||
    !session.startAt ||
    !session.endAt
  ) {
    return false;
  }

  if (
    !isBookingConfirmationMessage(
      currentMessage,
    )
  ) {
    return false;
  }

  return true;
}

/*
 * --------------------------------------------------
 * Re-check booking availability before confirmation
 * --------------------------------------------------
 *
 * Appointment:
 *
 *   checks the exact slot inside the requested day.
 *
 * Accommodation:
 *
 *   checks the exact check-in -> check-out range.
 *
 * This is provider-neutral and works for both
 * booking domains.
 * --------------------------------------------------
 */

async function isBookingStillAvailable(
  context:
    IntegrationContext,

  bookingType:
    BookingType,

  offeringId:
    string,

  startAt:
    string,

  endAt:
    string,

  timezone:
    string,

  adults:
    number |
    null = null,

  children:
    number |
    null = null,

  quantity:
    number |
    null = null,
):
  Promise<boolean> {

  let availabilityStart:
    string;

  let availabilityEnd:
    string;


  /*
   * ----------------------------------------------
   * Appointment availability
   * ----------------------------------------------
   */

  if (
    bookingType ===
    "appointment"
  ) {

    const date =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone:
            timezone,

          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",
        },
      ).format(
        new Date(
          startAt,
        ),
      );


    const range =
      buildDayRange(
        date,
        timezone,
      );


    availabilityStart =
      range.start;

    availabilityEnd =
      range.end;
  }

  /*
   * ----------------------------------------------
   * Accommodation availability
   * ----------------------------------------------
   */

  else {

    availabilityStart =
      startAt;

    availabilityEnd =
      endAt;
  }


  const availability =
    await getBookingAvailability(
      context,

      {
        type:
          bookingType,

        offeringId,

        start:
          availabilityStart,

        end:
          availabilityEnd,

        timezone,

        adults:
          adults ??
          undefined,

        children:
          children ??
          undefined,

        quantity:
          quantity ??
          undefined,
      },
    );


  /*
   * ----------------------------------------------
   * Match the exact validated booking range
   * ----------------------------------------------
   */

  return availability.some(
    (
      slot,
    ) => {

      if (
        slot.available ===
        false
      ) {

        return false;
      }


      if (
        bookingType ===
        "appointment"
      ) {

        return (
          slot.start ===
            startAt &&

          slot.end ===
            endAt
        );
      }


      return (
        slot.start ===
          startAt &&

        slot.end ===
          endAt
      );
    },
  );
}

/*
 * --------------------------------------------------
 * Process booking conversation
 * --------------------------------------------------
 */

export async function processAIBooking(
  input:
    ProcessAIBookingInput,
):
  Promise<
    AIBookingResult
  > {

  const repository =
    new AIBookingSessionRepository(
      input.db,
    );

  /*
   * ----------------------------------------------
   * Load existing booking session.
   * ----------------------------------------------
   */

  let session =
    await repository.find(
      input.context.tenant.id,
      input.context.provider,
      input.conversationId,
    );

/*
 * --------------------------------------------------
 * Confirmed booking protection
 * --------------------------------------------------
 *
 * Once a booking is confirmed, a later affirmative
 * message must not reopen or reset that booking.
 *
 * The customer must explicitly request a new booking.
 */
if (
  session &&

  session.status ===
    "confirmed" &&

  readSessionData(
    session,
  ).pendingRescheduleConfirmation !==
    true &&

  !isExplicitNewBookingMessage(
    input.currentMessage,
  ) &&

  isBookingConfirmationMessage(
    input.currentMessage,
  )
) {

  const existingData =
    readSessionData(
      session,
    );


  const existingBookingId =
    typeof existingData.bookingId ===
      "string"

      ? existingData.bookingId

      : null;


  console.log(
    "AI BOOKING CONFIRMED SESSION PROTECTED",
    {
      tenantId:
        input.context.tenant.id,

      conversationId:
        input.conversationId,

      message:
        input.currentMessage,

      bookingId:
        existingBookingId,

      offeringId:
        session.offeringId,

      startAt:
        session.startAt,

      endAt:
        session.endAt,
    },
  );


  return {

    handled:
      true,

    state:
      "confirmed",

    intent:
      {
        action:
          "none",

        bookingType:
          session.bookingType,

        offeringQuery:
          getStoredString(
            session,
            "offeringQuery",
          ),

        branchQuery:
          getStoredString(
            session,
            "branchQuery",
          ),

        resourceQuery:
          getStoredString(
            session,
            "resourceQuery",
          ),

        date:
          getStoredString(
            session,
            "date",
          ),

        time:
          getStoredString(
            session,
            "time",
          ),

        start:
          session.startAt,

        end:
          session.endAt,

        adults:
          session.adults,

        children:
          session.children,

        quantity:
          session.quantity,

        slotNumber:
          null,

        confidence:
          1,

        reason:
          "Existing booking is already confirmed.",
      },

    message:
      existingBookingId
        ? `Your appointment is already confirmed. Your booking reference is ${existingBookingId}.`
        : "Your appointment is already confirmed.",

    session,
  };
}


  /*
   * ----------------------------------------------
   * Extract intent using the current session.
   * ----------------------------------------------
   */

    let intent =
    await extractBookingIntent(
      input.ai,
      input.history,
      input.currentMessage,
      input.occurredAt,
      session,
    );

   
 const availabilityRefinementRequested =
    isAvailabilityRefinementMessage(
      input.currentMessage,
    );

    /*
 * --------------------------------------------------
 * Deterministic confirmed-booking action routing
 * --------------------------------------------------
 *
 * The LLM must not be allowed to reinterpret a
 * confirmed-booking reschedule request as a new
 * booking / ordinary conversation.
 *
 * Examples:
 *
 * "Can I reschedule it?"
 * "I want to move my appointment"
 * "Can I change my appointment to tomorrow?"
 * --------------------------------------------------
 */

const confirmedBookingData =
  readSessionData(
    session,
  );


const confirmedBookingId =
  typeof confirmedBookingData.bookingId ===
    "string"
    ? confirmedBookingData.bookingId
    : null;


const confirmedBookingRescheduleRequested =
  Boolean(
    session &&

    session.status ===
      "confirmed" &&

    confirmedBookingId &&

    isRescheduleRequestMessage(
      input.currentMessage,
    ),
  );


if (
  confirmedBookingRescheduleRequested
) {

  intent = {
    ...intent,

    action:
      "continue",

    bookingType:
      session!.bookingType,

    offeringQuery:
      intent.offeringQuery ??
      getStoredString(
        session,
        "offeringQuery",
      ),

      date:
      intent.date ??
      null,

      time:
        intent.time ??
        null,

    confidence:
      1,

    reason:
      "Deterministic confirmed-booking reschedule request.",
  };


  console.log(
    "AI BOOKING RESCHEDULE ROUTED DETERMINISTICALLY",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        confirmedBookingId,

      message:
        input.currentMessage,

      date:
        intent.date,

      time:
        intent.time,
    },
  );
}

    /*
 * --------------------------------------------------
 * Real booking cancellation
 * --------------------------------------------------
 *
 * A confirmed appointment is different from an
 * unconfirmed AI booking flow.
 *
 * Flow:
 *
 * 1. Customer requests cancellation.
 * 2. Core identifies the real booking.
 * 3. Core asks for explicit confirmation.
 * 4. Only the explicit confirmation executes
 *    cancellation at the provider.
 * 5. Provider result is verified.
 * 6. Result is persisted.
 * --------------------------------------------------
 */

const existingSessionData =
  readSessionData(
    session,
  );


const existingBookingId =
  typeof existingSessionData.bookingId ===
    "string"
    ? existingSessionData.bookingId
    : null;


const cancellationPending =
  existingSessionData.pendingCancellation ===
  true;

/*
 * --------------------------------------------------
 * Pending cancellation state lock
 * --------------------------------------------------
 *
 * While cancellation confirmation is pending,
 * no booking, reschedule, slot, or availability
 * logic may process the message.
 * --------------------------------------------------
 */

if (
  session &&
  session.status ===
    "confirmed" &&
  existingBookingId &&
  cancellationPending
) {

  /*
   * ----------------------------------------------
   * Customer declined cancellation
   * ----------------------------------------------
   */

  if (
    isCancellationDeclineMessage(
      input.currentMessage,
    )
  ) {

    existingSessionData.pendingCancellation =
      false;

    existingSessionData.cancellationRequestedAt =
      null;

    existingSessionData.cancellationResult =
      "declined";

    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.updatedAt =
      input.occurredAt;

    await saveSession(
      repository,
      session,
    );

    console.log(
      "AI BOOKING CANCELLATION DECLINED",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          existingBookingId,

        message:
          input.currentMessage,
      },
    );

    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "No problem. Your appointment remains unchanged.",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Customer has not answered yes/no
   * ----------------------------------------------
   */

  if (
    !isCancellationConfirmationMessage(
      input.currentMessage,
    )
  ) {

    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "Please confirm whether you want me to cancel your appointment.",

      session,
    };
  }
}

/*
 * ----------------------------------------------
 * Confirm cancellation
 * ----------------------------------------------
 */

if (
  session &&

  session.status ===
    "confirmed" &&

  existingBookingId &&

  cancellationPending &&

  isCancellationConfirmationMessage(
    input.currentMessage,
  )
) {

  console.log(
    "AI BOOKING CANCELLATION CONFIRMATION",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        existingBookingId,
    },
  );


  try {

    const currentBooking =
      await getBooking(
        input.context,

        existingBookingId,
      );


    /*
     * ------------------------------------------
     * Already cancelled
     * ------------------------------------------
     */

    if (
      currentBooking.status ===
        "cancelled"
    ) {

      existingSessionData.pendingCancellation =
        false;

      existingSessionData.cancelledAt =
        input.occurredAt;

      existingSessionData.cancellationResult =
        "already_cancelled";

      session.dataJson =
        JSON.stringify(
          existingSessionData,
        );

      session.status =
        "cancelled";

      session.updatedAt =
        input.occurredAt;

      await saveSession(
        repository,
        session,
      );


      return {
        handled:
          true,

        state:
          "cancelled",

        intent,

        message:
          "Your appointment has already been cancelled.",

        session,

        actionExecuted:
          false,

        actionResult:
          "none",
      };
    }


    /*
     * ------------------------------------------
     * Execute real provider cancellation
     * ------------------------------------------
     */

    const cancellationResult =
      await cancelBooking(
        input.context,

        existingBookingId,
      );


    /*
     * ------------------------------------------
     * Verify provider result
     * ------------------------------------------
     */

    if (
      cancellationResult.status !==
        "cancelled"
    ) {

      console.error(
        "AI BOOKING CANCELLATION FAILED: provider did not confirm cancellation",
        {
          tenantId:
            input.context.tenant.id,

          provider:
            input.context.provider,

          conversationId:
            input.conversationId,

          bookingId:
            existingBookingId,

          providerStatus:
            cancellationResult.status,
        },
      );


      existingSessionData.pendingCancellation =
        false;

      existingSessionData.cancellationResult =
        "failed";

      session.dataJson =
        JSON.stringify(
          existingSessionData,
        );

      session.updatedAt =
        input.occurredAt;

      await saveSession(
        repository,
        session,
      );


      return {
        handled:
          true,

        state:
          "confirmed",

        intent,

        message:
          "I couldn't cancel the appointment with our booking system. Please try again or contact our team.",

        session,

        actionExecuted:
          false,

        actionResult:
          "failed",
      };
    }


    /*
     * ------------------------------------------
     * Persist successful cancellation
     * ------------------------------------------
     */

    existingSessionData.pendingCancellation =
      false;

    existingSessionData.cancelledAt =
      input.occurredAt;

    existingSessionData.cancellationResult =
      "success";

    existingSessionData.cancellationAudit =
      {
        action:
          "cancellation",

        result:
          "success",

        requestedAt:
          existingSessionData.cancellationRequestedAt ??
          session.createdAt,

        authorizedAt:
          input.occurredAt,

        executedAt:
          new Date().toISOString(),

        provider:
          input.context.provider,

        bookingId:
          existingBookingId,

        offeringId:
          cancellationResult.offeringId,

        customerId:
          cancellationResult.customerId,

        previousStart:
          cancellationResult.start,

        previousEnd:
          cancellationResult.end,
      };


    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.status =
      "cancelled";

    session.pendingSlotsJson =
      null;

    session.startAt =
      null;

    session.endAt =
      null;

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,
      session,
    );


    console.log(
      "AI BOOKING CANCELLATION SUCCESS",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          existingBookingId,

        status:
          cancellationResult.status,
      },
    );


    return {
      handled:
        true,

      state:
        "cancelled",

      intent,

      message:
        "Your appointment has been cancelled successfully.",

      session,

      actionExecuted:
        true,

      actionResult:
        "success",
    };

  } catch (
    error
  ) {

    console.error(
      "AI BOOKING CANCELLATION ERROR",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          existingBookingId,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );


    existingSessionData.pendingCancellation =
      false;

    existingSessionData.cancellationResult =
      "failed";

    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "I couldn't cancel the appointment right now. Please try again or contact our team.",

      session,

      actionExecuted:
        false,

      actionResult:
        "failed",
    };
  }
}


/*
 * ----------------------------------------------
 * Customer requests cancellation
 * ----------------------------------------------
 */

if (
  session &&

  session.status ===
    "confirmed" &&

  existingBookingId &&

  isCancellationRequestMessage(
    input.currentMessage,
  )
) {

  existingSessionData.pendingCancellation =
    true;

  existingSessionData.cancellationRequestedAt =
    input.occurredAt;

  existingSessionData.cancellationResult =
    "pending";


  session.dataJson =
    JSON.stringify(
      existingSessionData,
    );

  session.updatedAt =
    input.occurredAt;


  await saveSession(
    repository,

    session,
  );


  console.log(
    "AI BOOKING CANCELLATION REQUESTED",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        existingBookingId,
    },
  );


  return {
    handled:
      true,

    state:
      "confirmed",

    intent,

    message:
      "I can cancel your appointment. Please confirm that you want me to cancel it.",

    session,
  };
}


/*
 * ----------------------------------------------
 * Cancellation requested but booking ID missing
 * ----------------------------------------------
 */

if (
  session &&

  session.status ===
    "confirmed" &&

  isCancellationRequestMessage(
    input.currentMessage,
  ) &&

  !existingBookingId
) {

  console.error(
    "AI BOOKING CANCELLATION FAILED: booking reference missing",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,
    },
  );


  return {
    handled:
      true,

    state:
      "confirmed",

    intent,

    message:
      "I couldn't find the booking reference for your appointment. Please contact our team so we can help with the cancellation.",

    session,
  };
}

/*
 * --------------------------------------------------
 * Real booking reschedule request
 * --------------------------------------------------
 *
 * This patch only captures the requested change.
 *
 * It does NOT call updateBooking().
 *
 * Flow:
 *
 * Customer:
 *   "I want to reschedule my appointment"
 *
 * Core:
 *   identify booking
 *   capture requested date/time
 *   ask for missing information if necessary
 *   persist pending reschedule state
 *
 * Actual provider update will happen only after
 * availability is checked and the customer explicitly
 * confirms the new slot.
 * --------------------------------------------------
 */

if (
  session &&

  session.status ===
    "confirmed" &&

  existingBookingId &&

  isRescheduleRequestMessage(
    input.currentMessage,
  )
) {

  const requestedDate =
    intent.date ??
    null;


  const requestedTime =
    intent.time ??
    null;


  const currentBooking =
    await getBooking(
      input.context,

      existingBookingId,
    );


  /*
   * ----------------------------------------------
   * Booking no longer exists / already cancelled
   * ----------------------------------------------
   */

  if (
    currentBooking.status ===
      "cancelled"
  ) {

    return {
      handled:
        true,

      state:
        "cancelled",

      intent,

      message:
        "That appointment has already been cancelled, so there isn't an active appointment to reschedule.",

      session,
    };
  }


  const rescheduleData =
    readSessionData(
      session,
    );


  rescheduleData.pendingReschedule =
    true;

  rescheduleData.pendingRescheduleConfirmation =
  false;

  rescheduleData.rescheduleStart =
    null;

  rescheduleData.rescheduleEnd =
    null;

  rescheduleData.rescheduleDate =
  null;




  rescheduleData.rescheduleRequestedAt =
    input.occurredAt;


  rescheduleData.rescheduleBookingId =
    existingBookingId;


  rescheduleData.originalStart =
    currentBooking.start;


  rescheduleData.originalEnd =
    currentBooking.end;


  rescheduleData.originalOfferingId =
    currentBooking.offeringId;


  if (
    requestedDate
  ) {

    rescheduleData.rescheduleDate =
      requestedDate;
  }


  if (
    requestedTime
  ) {

    rescheduleData.rescheduleTime =
      requestedTime;
  }


  rescheduleData.rescheduleResult =
    "pending";


  session.dataJson =
    JSON.stringify(
      rescheduleData,
    );

  session.updatedAt =
    input.occurredAt;


  await saveSession(
    repository,

    session,
  );


  console.log(
    "AI BOOKING RESCHEDULE REQUESTED",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        existingBookingId,

      requestedDate,

      requestedTime,
    },
  );


  /*
   * ----------------------------------------------
   * Need date
   * ----------------------------------------------
   */

  if (
    !requestedDate
  ) {

    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "Sure. What date would you like to move your appointment to?",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Need time
   * ----------------------------------------------
   */

  if (
    !requestedTime
  ) {

    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "Sure. What time would you like to move your appointment to?",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Date and time captured.
   *
   * Do not update GHL yet.
   * ----------------------------------------------
   */

  return {
    handled:
      true,

    state:
      "confirmed",

    intent,

    message:
      `Got it. You'd like to move your appointment to ${requestedDate} at ${requestedTime}. I'll check that slot before making the change.`,

    session,
  };
}

/*
 * --------------------------------------------------
 * Resolve pending reschedule request
 * --------------------------------------------------
 *
 * The customer has already requested a reschedule.
 *
 * This block:
 *
 * 1. Reads the requested date/time.
 * 2. Retrieves the current provider booking.
 * 3. Checks live provider availability.
 * 4. Matches the requested time against an actual
 *    available slot.
 * 5. Stores the exact replacement slot.
 * 6. Asks the customer for explicit confirmation.
 *
 * updateBooking() is NOT called here.
 * --------------------------------------------------
 */

if (
  session &&

  session.status ===
    "confirmed" &&

  existingBookingId &&

  existingSessionData.pendingReschedule ===
    true &&

  existingSessionData.pendingRescheduleConfirmation !==
    true
) {

  const requestedDate =
    intent.date ??
    (
      typeof existingSessionData.rescheduleDate ===
        "string"
        ? existingSessionData.rescheduleDate
        : null
    );


  const requestedTime =
    intent.time ??
    (
      typeof existingSessionData.rescheduleTime ===
        "string"
        ? existingSessionData.rescheduleTime
        : null
    );


  /*
   * ----------------------------------------------
   * Persist newly supplied date/time
   * ----------------------------------------------
   */

  if (
    intent.date
  ) {

    existingSessionData.rescheduleDate =
      intent.date;
  }


  if (
    intent.time
  ) {

    existingSessionData.rescheduleTime =
      intent.time;
  }


  /*
   * ----------------------------------------------
   * Need date
   * ----------------------------------------------
   */

  if (
    !requestedDate
  ) {

    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,
      session,
    );


    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "Sure. What date would you like to move your appointment to?",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Need time
   * ----------------------------------------------
   */

  if (
    !requestedTime
  ) {

    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,
      session,
    );


    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "What time would you like to move your appointment to?",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Retrieve current live booking
   * ----------------------------------------------
   */

  const currentBooking =
    await getBooking(
      input.context,

      existingBookingId,
    );


  /*
   * ----------------------------------------------
   * Booking was cancelled externally
   * ----------------------------------------------
   */

  if (
    currentBooking.status ===
      "cancelled"
  ) {

    existingSessionData.pendingReschedule =
      false;

    existingSessionData.rescheduleResult =
      "booking_cancelled";


    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.status =
      "cancelled";

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {
      handled:
        true,

      state:
        "cancelled",

      intent,

      message:
        "That appointment has already been cancelled, so I can't reschedule it.",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Convert requested local date/time to ISO
   * ----------------------------------------------
   */

  let requestedStart:
    string;

  try {

    requestedStart =
      localDateTimeToISO(
        requestedDate,

        requestedTime,

        input.timezone ??
          DEFAULT_TIMEZONE,
      );

  } catch (
    error
  ) {

    console.error(
      "AI BOOKING RESCHEDULE INVALID DATE TIME",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          existingBookingId,

        requestedDate,

        requestedTime,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );


    existingSessionData.rescheduleResult =
      "invalid_date_time";


    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "I couldn't understand that date and time. Please provide the new date and time again.",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Check live availability for requested day
   * ----------------------------------------------
   */

  const availabilityRange =
    buildDayRange(
      requestedDate,

      input.timezone ??
        DEFAULT_TIMEZONE,
    );


  const availability =
    await getBookingAvailability(
      input.context,

      {
        type:
          "appointment",

        offeringId:
          currentBooking.offeringId,

        start:
          availabilityRange.start,

        end:
          availabilityRange.end,

        timezone:
          input.timezone ??
          DEFAULT_TIMEZONE,
      },
    );


  /*
   * ----------------------------------------------
   * Find the exact requested slot
   * ----------------------------------------------
   */

  const matchingSlot =
    availability.find(
      (
        slot,
      ) =>
        slot.available !==
          false &&

        slot.start ===
          requestedStart,
    );


  /*
   * ----------------------------------------------
   * Requested time unavailable
   * ----------------------------------------------
   */

  if (
    !matchingSlot
  ) {

    existingSessionData.rescheduleStart =
      null;

    existingSessionData.rescheduleEnd =
      null;

    existingSessionData.rescheduleResult =
      "slot_unavailable";


    session.dataJson =
      JSON.stringify(
        existingSessionData,
      );

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    console.log(
      "AI BOOKING RESCHEDULE SLOT UNAVAILABLE",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          existingBookingId,

        requestedStart,

        requestedDate,

        requestedTime,
      },
    );


    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        `That time isn't available on ${requestedDate}. Please give me another time for the same date.`,

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Store exact replacement slot
   * ----------------------------------------------
   */

  existingSessionData.rescheduleStart =
    matchingSlot.start;


  existingSessionData.rescheduleEnd =
    matchingSlot.end;


  existingSessionData.rescheduleDate =
    requestedDate;


  existingSessionData.rescheduleTime =
    requestedTime;


  existingSessionData.rescheduleResult =
    "awaiting_confirmation";


  existingSessionData.pendingRescheduleConfirmation =
    true;


  existingSessionData.originalBookingId =
    existingBookingId;


  existingSessionData.originalStart =
    currentBooking.start;


  existingSessionData.originalEnd =
    currentBooking.end;


  existingSessionData.originalOfferingId =
    currentBooking.offeringId;


  session.dataJson =
    JSON.stringify(
      existingSessionData,
    );

  session.updatedAt =
    input.occurredAt;


  await saveSession(
    repository,

    session,
  );


  console.log(
    "AI BOOKING RESCHEDULE SLOT READY",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        existingBookingId,

      originalStart:
        currentBooking.start,

      originalEnd:
        currentBooking.end,

      newStart:
        matchingSlot.start,

      newEnd:
        matchingSlot.end,
    },
  );

session.pendingSlotsJson =
  null;


session.status =
  "awaiting_confirmation";


session.updatedAt =
  input.occurredAt;


await saveSession(
  repository,
  session,
);


  return {
    handled:
      true,

    state:
      "awaiting_confirmation",

    intent,

    message:
      `That time is available. Would you like me to move your appointment to ${requestedDate} at ${requestedTime}?`,

    session,
  };
}

/*
 * --------------------------------------------------
 * Execute confirmed reschedule
 * --------------------------------------------------
 *
 * This is the final execution boundary for a
 * reschedule.
 *
 * Requirements:
 *
 * 1. A real booking must exist.
 * 2. A reschedule request must already be pending.
 * 3. The target slot must already have been resolved.
 * 4. The customer must explicitly confirm.
 * 5. Live availability is checked again.
 * 6. The provider update is executed.
 * 7. The provider result is verified.
 * 8. The new state is persisted.
 *
 * No provider mutation happens before this point.
 * --------------------------------------------------
 */

const rescheduleExecutionData =
  readSessionData(
    session,
  );


const rescheduleBookingId =
  typeof rescheduleExecutionData.rescheduleBookingId ===
    "string"
    ? rescheduleExecutionData.rescheduleBookingId
    : (
        typeof rescheduleExecutionData.bookingId ===
          "string"
          ? rescheduleExecutionData.bookingId
          : null
      );


const pendingRescheduleConfirmation =
  rescheduleExecutionData.pendingRescheduleConfirmation ===
    true;


const rescheduleStart =
  typeof rescheduleExecutionData.rescheduleStart ===
    "string"
    ? rescheduleExecutionData.rescheduleStart
    : null;


const rescheduleEnd =
  typeof rescheduleExecutionData.rescheduleEnd ===
    "string"
    ? rescheduleExecutionData.rescheduleEnd
    : null;


if (
  session &&
  (
  session.status ===
    "confirmed" ||

  session.status ===
    "awaiting_confirmation"
) &&

  rescheduleBookingId &&

  pendingRescheduleConfirmation &&

  rescheduleStart &&

  rescheduleEnd &&

  isRescheduleConfirmationMessage(
    input.currentMessage,
  )
) {

  console.log(
    "AI BOOKING RESCHEDULE CONFIRMATION",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        rescheduleBookingId,

      newStart:
        rescheduleStart,

      newEnd:
        rescheduleEnd,
    },
  );


  try {

    /*
     * ----------------------------------------------
     * Re-read current provider booking
     * ----------------------------------------------
     */

    const currentBooking =
      await getBooking(
        input.context,

        rescheduleBookingId,
      );


    /*
     * ----------------------------------------------
     * Booking was cancelled externally
     * ----------------------------------------------
     */

    if (
      currentBooking.status ===
        "cancelled"
    ) {

      rescheduleExecutionData.pendingReschedule =
        false;

      rescheduleExecutionData.pendingRescheduleConfirmation =
        false;

      rescheduleExecutionData.rescheduleResult =
        "booking_cancelled";


      session.dataJson =
        JSON.stringify(
          rescheduleExecutionData,
        );

      session.status =
        "cancelled";

      session.updatedAt =
        input.occurredAt;


      await saveSession(
        repository,

        session,
      );


      return {
        handled:
          true,

        state:
          "cancelled",

        intent,

        message:
          "That appointment has already been cancelled, so I can't reschedule it.",

        session,

        actionExecuted:
          false,

        actionResult:
          "none",
      };
    }


    /*
     * ----------------------------------------------
     * Re-check live availability
     * ----------------------------------------------
     */

    const targetDate =
      typeof rescheduleExecutionData.rescheduleDate ===
        "string"
        ? rescheduleExecutionData.rescheduleDate
        : new Intl.DateTimeFormat(
            "en-CA",
            {
              timeZone:
                input.timezone ??
                DEFAULT_TIMEZONE,

              year:
                "numeric",

              month:
                "2-digit",

              day:
                "2-digit",
            },
          ).format(
            new Date(
              rescheduleStart,
            ),
          );


    const availabilityRange =
      buildDayRange(
        targetDate,

        input.timezone ??
          DEFAULT_TIMEZONE,
      );


    const availability =
      await getBookingAvailability(
        input.context,

        {
          type:
            "appointment",

          offeringId:
            currentBooking.offeringId,

          start:
            availabilityRange.start,

          end:
            availabilityRange.end,

          timezone:
            input.timezone ??
            DEFAULT_TIMEZONE,
        },
      );


    const targetSlot =
      availability.find(
        (
          slot,
        ) =>
          slot.available !==
            false &&

          slot.start ===
            rescheduleStart &&

          slot.end ===
            rescheduleEnd,
      );


    /*
     * ----------------------------------------------
     * Target slot is no longer available
     * ----------------------------------------------
     */

    if (
      !targetSlot
    ) {

      rescheduleExecutionData.rescheduleResult =
        "slot_unavailable";

      rescheduleExecutionData.pendingRescheduleConfirmation =
        false;


      session.dataJson =
        JSON.stringify(
          rescheduleExecutionData,
        );

      session.updatedAt =
        input.occurredAt;


      await saveSession(
        repository,

        session,
      );


      console.log(
        "AI BOOKING RESCHEDULE EXECUTION SLOT NO LONGER AVAILABLE",
        {
          tenantId:
            input.context.tenant.id,

          provider:
            input.context.provider,

          conversationId:
            input.conversationId,

          bookingId:
            rescheduleBookingId,

          newStart:
            rescheduleStart,

          newEnd:
            rescheduleEnd,
        },
      );


      return {
        handled:
          true,

        state:
          "confirmed",

        intent,

        message:
          "That appointment time is no longer available. Please choose another available time.",

        session,

        actionExecuted:
          false,

        actionResult:
          "failed",
      };
    }


    /*
     * ----------------------------------------------
     * Execute provider update
     * ----------------------------------------------
     */

    console.log(
      "AI BOOKING RESCHEDULE UPDATE START",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          rescheduleBookingId,

        oldStart:
          currentBooking.start,

        oldEnd:
          currentBooking.end,

        newStart:
          rescheduleStart,

        newEnd:
          rescheduleEnd,
      },
    );


    const rescheduleExecutionClaimId =
  crypto.randomUUID();


const rescheduleExecutionClaimed =
  await repository.claimBookingExecution(
    input.context.tenant.id,

    input.context.provider,

    input.conversationId,

    rescheduleExecutionClaimId,

    "reschedule",
  );


if (
  !rescheduleExecutionClaimed
) {

  console.log(
    "AI BOOKING RESCHEDULE EXECUTION CLAIMED BY ANOTHER REQUEST",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        rescheduleBookingId,
    },
  );


  rescheduleExecutionData.pendingRescheduleConfirmation =
    false;

  rescheduleExecutionData.rescheduleResult =
    "already_processing";


  session.dataJson =
    JSON.stringify(
      rescheduleExecutionData,
    );

  session.updatedAt =
    input.occurredAt;


  await saveSession(
    repository,

    session,
  );


  return {
    handled:
      true,

    state:
      "confirmed",

    intent,

    message:
      "Your reschedule request is already being processed. Please wait a moment.",

    session,

    actionExecuted:
      false,

    actionResult:
      "none",
  };
}


/*
 * ----------------------------------------------
 * Execute provider update
 * ----------------------------------------------
 */

  const updatedBooking =
    await updateBooking(
      input.context,

      rescheduleBookingId,

      {
        start:
          rescheduleStart,

        end:
          rescheduleEnd,

        offeringId:
          currentBooking.offeringId,
      },
    );


    /*
     * ----------------------------------------------
     * Verify provider mutation
     * ----------------------------------------------
     */

    if (
      updatedBooking.status ===
        "cancelled"
    ) {

      rescheduleExecutionData.pendingReschedule =
        false;

      rescheduleExecutionData.pendingRescheduleConfirmation =
        false;

      rescheduleExecutionData.rescheduleResult =
        "provider_cancelled";


      session.dataJson =
        JSON.stringify(
          rescheduleExecutionData,
        );

      session.status =
        "cancelled";

      session.updatedAt =
        input.occurredAt;


      await saveSession(
        repository,

        session,
      );


      return {
        handled:
          true,

        state:
          "cancelled",

        intent,

        message:
          "The appointment could not be rescheduled because the booking was cancelled by the booking system.",

        session,

        actionExecuted:
          true,

        actionResult:
          "failed",
      };
    }


    const verifiedBooking =
      await getBooking(
        input.context,

        rescheduleBookingId,
      );


    const providerUpdateVerified =
      verifiedBooking.start ===
        rescheduleStart &&

      verifiedBooking.end ===
        rescheduleEnd;


    if (
      !providerUpdateVerified
    ) {

      console.error(
        "AI BOOKING RESCHEDULE VERIFICATION FAILED",
        {
          tenantId:
            input.context.tenant.id,

          provider:
            input.context.provider,

          conversationId:
            input.conversationId,

          bookingId:
            rescheduleBookingId,

          expectedStart:
            rescheduleStart,

          expectedEnd:
            rescheduleEnd,

          actualStart:
            verifiedBooking.start,

          actualEnd:
            verifiedBooking.end,
        },
      );


      rescheduleExecutionData.pendingReschedule =
        true;

      rescheduleExecutionData.pendingRescheduleConfirmation =
        false;

      rescheduleExecutionData.rescheduleResult =
        "verification_failed";


      session.dataJson =
        JSON.stringify(
          rescheduleExecutionData,
        );

      session.updatedAt =
        input.occurredAt;


      await saveSession(
        repository,

        session,
      );


      return {
        handled:
          true,

        state:
          "confirmed",

        intent,

        message:
          "I couldn't verify that the appointment was moved successfully. Please contact our team before trying again.",

        session,

        actionExecuted:
          true,

        actionResult:
          "failed",
      };
    }


    /*
     * ----------------------------------------------
     * Persist successful reschedule
     * ----------------------------------------------
     */

    rescheduleExecutionData.pendingReschedule =
      false;

    rescheduleExecutionData.pendingRescheduleConfirmation =
      false;

    rescheduleExecutionData.rescheduleResult =
      "success";

    rescheduleExecutionData.rescheduledAt =
      input.occurredAt;

    rescheduleExecutionData.rescheduleAudit =
      {

        action:
          "reschedule",

        result:
          "success",

        requestedAt:
          rescheduleExecutionData.rescheduleRequestedAt ??
          session.createdAt,

        authorizedAt:
          input.occurredAt,

        executedAt:
          new Date().toISOString(),

        provider:
          input.context.provider,

        bookingId:
          rescheduleBookingId,

        previousStart:
          currentBooking.start,

        previousEnd:
          currentBooking.end,

        newStart:
          verifiedBooking.start,

        newEnd:
          verifiedBooking.end,

        offeringId:
          verifiedBooking.offeringId,

        customerId:
          verifiedBooking.customerId,
      };


    rescheduleExecutionData.bookingId =
      verifiedBooking.bookingId;

    rescheduleExecutionData.confirmationCode =
      verifiedBooking.confirmationCode ??
      verifiedBooking.bookingId;

    rescheduleExecutionData.start =
      verifiedBooking.start;

    rescheduleExecutionData.end =
      verifiedBooking.end;

    rescheduleExecutionData.date =
      targetDate;


    if (
      typeof rescheduleExecutionData.rescheduleTime ===
        "string"
    ) {

      rescheduleExecutionData.time =
        rescheduleExecutionData.rescheduleTime;
    }


    session.dataJson =
      JSON.stringify(
        rescheduleExecutionData,
      );

    session.status =
      "confirmed";

    session.startAt =
      verifiedBooking.start;

    session.endAt =
      verifiedBooking.end;

    session.offeringId =
      verifiedBooking.offeringId;

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    console.log(
      "AI BOOKING RESCHEDULE SUCCESS",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          verifiedBooking.bookingId,

        previousStart:
          currentBooking.start,

        previousEnd:
          currentBooking.end,

        newStart:
          verifiedBooking.start,

        newEnd:
          verifiedBooking.end,
      },
    );


    const newBookingDate =
      new Intl.DateTimeFormat(
        "en-MY",
        {
          timeZone:
            input.timezone ??
            DEFAULT_TIMEZONE,

          year:
            "numeric",

          month:
            "long",

          day:
            "numeric",
        },
      ).format(
        new Date(
          verifiedBooking.start,
        ),
      );


    const newBookingTime =
      new Intl.DateTimeFormat(
        "en-MY",
        {
          timeZone:
            input.timezone ??
            DEFAULT_TIMEZONE,

          hour:
            "numeric",

          minute:
            "2-digit",
        },
      ).format(
        new Date(
          verifiedBooking.start,
        ),
      );


    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        `Your appointment has been rescheduled successfully to ${newBookingDate} at ${newBookingTime}.`,

      session,

      actionExecuted:
        true,

      actionResult:
        "success",
    };

  } catch (
    error
  ) {

    console.error(
      "AI BOOKING RESCHEDULE EXECUTION ERROR",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        bookingId:
          rescheduleBookingId,

        newStart:
          rescheduleStart,

        newEnd:
          rescheduleEnd,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );


    rescheduleExecutionData.pendingRescheduleConfirmation =
      false;

    rescheduleExecutionData.rescheduleResult =
      "failed";


    session.dataJson =
      JSON.stringify(
        rescheduleExecutionData,
      );

    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        "I couldn't reschedule the appointment right now. Please try again or contact our team.",

      session,

      actionExecuted:
        false,

      actionResult:
        "failed",
    };
  }
}
 
/*
 * --------------------------------------------------
 * Active booking session takes priority
 * --------------------------------------------------
 *
 * When we are already inside a booking flow,
 * short replies such as "1", "2", or a calendar
 * name are selections, not ordinary conversation.
 *
 * This must run BEFORE the generic "action === none"
 * exit.
 */

if (
  session &&

  session.status !==
    "confirmed" &&

  session.status !==
    "cancelled" &&

  session.bookingType ===
    "appointment" &&

  !session.offeringId
) {

  const offerings =
    await listBookingOfferings(
      input.context,

      "appointment",
    );


  const selectedOffering =
    resolveOfferingSelection(
      offerings,

      input.currentMessage,
    );


  if (
    selectedOffering
  ) {

    console.log(
      "AI BOOKING OFFERING SELECTED DETERMINISTICALLY",
      {
        tenantId:
          input.context.tenant.id,

        conversationId:
          input.conversationId,

        message:
          input.currentMessage,

        offeringId:
          selectedOffering.id,

        offeringName:
          selectedOffering.name,
      },
    );


    intent = {

      ...intent,

      action:
        "continue",

      bookingType:
        "appointment",

      offeringQuery:
        selectedOffering.name,

      confidence:
        1,

      reason:
        "Selected from active booking offerings.",
    };
  }
}

/*
 * --------------------------------------------------
 * Deterministic pending-slot selection
 * --------------------------------------------------
 */

if (
  session &&

  session.status ===
    "awaiting_slot_selection"
) {

  const selectedSlot =
    resolvePendingSlotSelection(

      session,

      input.currentMessage,

      input.timezone ??
        DEFAULT_TIMEZONE,
    );


  if (
    selectedSlot
  ) {

    const selectedDate =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone:
            input.timezone ??
            DEFAULT_TIMEZONE,

          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",
        },
      ).format(
        new Date(
          selectedSlot.start,
        ),
      );


    const selectedTime =
      formatSlot(
        selectedSlot,

        input.timezone ??
          DEFAULT_TIMEZONE,
      );


    console.log(
      "AI BOOKING SLOT SELECTED DETERMINISTICALLY",
      {
        tenantId:
          input.context.tenant.id,

        conversationId:
          input.conversationId,

        message:
          input.currentMessage,

        slotStart:
          selectedSlot.start,

        slotEnd:
          selectedSlot.end,

        selectedDate,

        selectedTime,
      },
    );


    intent = {

      ...intent,

      action:
        "select_slot",

      bookingType:
        "appointment",

      date:
        selectedDate,

      time:
        selectedTime,

      start:
        selectedSlot.start,

      end:
        selectedSlot.end,

      confidence:
        1,

      reason:
        "Selected from active pending availability slots.",
    };
  }
}


/*
 * --------------------------------------------------
 * Prevent confirmation without a slot
 * --------------------------------------------------
 */

if (
  session &&

  session.status ===
    "awaiting_slot_selection"
) {

  const pendingSlots =
    parsePendingSlots(
      session,
    );


  const validPendingSlotSelection =
  intent.action ===
    "select_slot" &&

  typeof intent.start ===
    "string" &&

  typeof intent.end ===
    "string" &&

  intent.start.length >
    0 &&

  intent.end.length >
    0 &&

  intent.reason ===
    "Selected from active pending availability slots.";


if (
  pendingSlots.length >
    0 &&

  !validPendingSlotSelection &&

  intent.action !==
    "cancel" &&

  intent.action !==
    "start" &&

  !availabilityRefinementRequested
) {

    console.log(
      "AI BOOKING WAITING FOR SLOT SELECTION",
      {
        conversationId:
          input.conversationId,

        message:
          input.currentMessage,

        pendingSlotCount:
          pendingSlots.length,
      },
    );


    return {

      handled:
        true,

      state:
        "awaiting_slot_selection",

      intent,

      message:
        buildAvailabilityMessage(
          pendingSlots,

          input.timezone ??
            DEFAULT_TIMEZONE,
        ),

      session,
    };
  }
}

/*
 * --------------------------------------------------
 * Deterministic booking confirmation
 * --------------------------------------------------
 *
 * The Core has already:
 *
 * 1. resolved the offering
 * 2. checked provider availability
 * 3. stored the exact slot
 * 4. asked the customer for confirmation
 *
 * Therefore a clear affirmative response means
 * "confirm this exact booking".
 */
if (
  session &&

  session.status ===
    "awaiting_confirmation" &&

  session.offeringId &&

  session.startAt &&

  session.endAt &&

  isBookingConfirmationMessage(
    input.currentMessage,
  )
) {

 const slotStillAvailable =
  await isBookingStillAvailable(
    input.context,

    session.bookingType,

    session.offeringId,

    session.startAt,

    session.endAt,

    input.timezone ??
      DEFAULT_TIMEZONE,

    session.adults,

    session.children,

    session.quantity,
  );

if (
  !slotStillAvailable
) {

  console.log(
    "AI BOOKING CONFIRMATION SLOT NO LONGER AVAILABLE",
    {
      tenantId:
        input.context.tenant.id,

      conversationId:
        input.conversationId,

      offeringId:
        session.offeringId,

      startAt:
        session.startAt,

      endAt:
        session.endAt,
    },
  );

  session.status =
    "collecting";

  session.pendingSlotsJson =
    null;

  session.startAt =
    null;

  session.endAt =
    null;

  session.updatedAt =
    input.occurredAt;

  await saveSession(
    repository,
    session,
  );

  return {
    handled:
      true,

    state:
      "collecting",

    intent,

    message:
      "That appointment time is no longer available. Let’s check the available times again.",

    session,
  };
}

  console.log(
    "AI BOOKING CONFIRMATION DETECTED DETERMINISTICALLY",
    {
      tenantId:
        input.context.tenant.id,

      conversationId:
        input.conversationId,

      message:
        input.currentMessage,

      offeringId:
        session.offeringId,

      startAt:
        session.startAt,

      endAt:
        session.endAt,
    },
  );


  intent = {

    ...intent,

    action:
      "confirm",

    bookingType:
      session.bookingType,

    offeringQuery:
      intent.offeringQuery ??
      getStoredString(
        session,
        "offeringQuery",
      ),

    date:
      intent.date ??
      getStoredString(
        session,
        "date",
      ),

    time:
      intent.time ??
      getStoredString(
        session,
        "time",
      ),

    start:
      session.startAt,

    end:
      session.endAt,

    confidence:
      1,

    reason:
      "Confirmed the exact booking already presented by the booking engine.",
  };
}

console.log(
  "AI BOOKING INTENT AFTER SESSION RESOLUTION",
  {
    conversationId:
      input.conversationId,

    message:
      input.currentMessage,

    action:
      intent.action,

    bookingType:
      intent.bookingType,

    offeringQuery:
      intent.offeringQuery,

    date:
      intent.date,

    time:
      intent.time,

    sessionStatus:
      session?.status ??
      null,

    sessionOfferingId:
      session?.offeringId ??
      null,
  },
);

/*
 * --------------------------------------------------
 * Availability refinement has booking context.
 * --------------------------------------------------
 *
 * Messages such as:
 *
 * - "Do you have evening time?"
 * - "Anything later?"
 * - "What about morning?"
 *
 * are booking-flow messages even when the LLM
 * classifies them as "none".
 */

if (
  session &&

  session.status !==
    "confirmed" &&

  session.status !==
    "cancelled" &&

  session.bookingType ===
    "appointment" &&

  session.offeringId &&

  isAvailabilityRefinementMessage(
    input.currentMessage,
  )
) {

  intent = {

  ...intent,

  action:
    "continue",

  bookingType:
    session.bookingType ??
    "appointment",

  time:
    null,

  start:
    null,

  end:
    null,

  confidence:
    1,

  reason:
    "Availability refinement inside an active booking session.",
};


  console.log(
    "AI BOOKING AVAILABILITY REFINEMENT DETECTED",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      message:
        input.currentMessage,

      bookingType:
        intent.bookingType,
    },
  );
}

  /*
   * ----------------------------------------------
   * No booking intent.
   * ----------------------------------------------
   */

  if (
    intent.action ===
      "none"
  ) {

    return {

      handled:
        false,

      state:
        session?.status ??
        null,

      intent,

      message:
        "",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Determine booking type.
   * ----------------------------------------------
   */

  const bookingType =
    intent.bookingType ??
    session?.bookingType ??
    null;


  if (
    !bookingType
  ) {

    return {

      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        "Sure. What would you like to book?",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Start a new booking.
   * ----------------------------------------------
   */

  if (
  intent.action ===
  "start"
) {

  /*
   * Start fresh when:
   *
   * - no session exists
   * - previous booking is confirmed
   * - previous booking is cancelled
   * - previous flow is awaiting slot selection
   * - booking type has changed
   *
   * The last condition prevents stale state from
   * one booking type leaking into another.
   */

  const shouldCreateFreshSession =
    !session ||

    session.status ===
      "confirmed" ||

    session.status ===
      "cancelled" ||

    session.status ===
      "awaiting_slot_selection" ||

    session.bookingType !==
      bookingType;


  if (
  shouldCreateFreshSession
) {
  session =
    createFreshSession(
      input.context,

      input.conversationId,

      bookingType,
    );

} else if (
  session
) {
  session.bookingType =
    bookingType;
}
}

  /*
   * ----------------------------------------------
   * Create session when none exists.
   * ----------------------------------------------
   */

  if (
    !session
  ) {

    session =
      createFreshSession(

        input.context,

        input.conversationId,

        bookingType,
      );
  }


  /*
   * ----------------------------------------------
   * Persist booking type.
   * ----------------------------------------------
   */

  session.bookingType =
    bookingType;


  /*
   * ----------------------------------------------
   * Merge data.
   * ----------------------------------------------
   */

  session.dataJson =
    buildDataJson(
      session,

      intent,
    );

  /*
 * ----------------------------------------------
 * Synchronize structured session fields
 * ----------------------------------------------
 *
 * The session fields are the authoritative working
 * state for the booking engine.
 *
 * Current intent values take precedence.
 * Existing values are retained when the current
 * message does not provide them.
 * ----------------------------------------------
 */

session.adults =
  intent.adults ??
  getStoredNumber(
    session,
    "adults",
  );


session.children =
  intent.children ??
  getStoredNumber(
    session,
    "children",
  );


session.quantity =
  intent.quantity ??
  getStoredNumber(
    session,
    "quantity",
  );

console.log(
  "AI BOOKING SESSION ATTRIBUTES",
  {
    tenantId:
      input.context.tenant.id,

    provider:
      input.context.provider,

    conversationId:
      input.conversationId,

    bookingType:
      bookingType,

    offeringId:
      session.offeringId,

    adults:
      session.adults,

    children:
      session.children,

    quantity:
      session.quantity,

    date:
      getStoredString(
        session,
        "date",
      ),

    time:
      getStoredString(
        session,
        "time",
      ),
  },
);

  /*
   * ----------------------------------------------
   * Cancel booking flow.
   * ----------------------------------------------
   */

  if (
    intent.action ===
    "cancel"
  ) {

    session.status =
      "cancelled";


    session.pendingSlotsJson =
      null;


    session.startAt =
      null;

    session.endAt =
  null;


  session.dataJson =
  JSON.stringify({});


session.updatedAt =
  input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {

      handled:
        true,

      state:
        "cancelled",

      intent,

      message:
        "No problem. I’ve cancelled the booking process.",

      session,

      actionExecuted:
        false,

      actionResult:
        "none",
    };
  }


  /*
 * ----------------------------------------------
 * Provider capability check
 * ----------------------------------------------
 *
 * The booking engine must never assume that every
 * configured provider supports every booking domain.
 *
 * Capability is determined by the provider rather
 * than by hard-coded industry logic.
 * ----------------------------------------------
 */

const bookingTypeSupported =
  await supportsBookingType(
    input.context,
    bookingType,
  );

console.log(
  "AI BOOKING PROVIDER CAPABILITY",
  {
    tenantId:
      input.context.tenant.id,

    provider:
      input.context.provider,

    conversationId:
      input.conversationId,

    bookingType,

    supported:
      bookingTypeSupported,
  },
);


if (
  !bookingTypeSupported
) {

  session.status =
    "collecting";

  session.updatedAt =
    input.occurredAt;

  await saveSession(
    repository,
    session,
  );


  return {

    handled:
      true,

    state:
      "collecting",

    intent,

    message:
      "I can help with that booking, but this booking type is not connected to the current booking provider yet.",

    session,
  };
}


  /*
   * ----------------------------------------------
   * Resolve offering.
   * ----------------------------------------------
   */

  const storedOfferingQuery =
    getStoredString(
      session,

      "offeringQuery",
    );


  const storedBranchQuery =
    getStoredString(
      session,

      "branchQuery",
    );


  const offeringQuery =
    intent.offeringQuery ??
    storedOfferingQuery;


  const branchQuery =
    intent.branchQuery ??
    storedBranchQuery;


  const resolved =
    await resolveOffering(

      input.context,

      bookingType,

      offeringQuery,

      branchQuery,
    );


  /*
   * ----------------------------------------------
   * No offering selected yet.
   * ----------------------------------------------
   */

  if (
    !resolved.offering
  ) {

    session.status =
      "collecting";


    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {

      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        buildOfferingPrompt(
          resolved.offerings,

          bookingType,
        ),

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Store selected offering.
   * ----------------------------------------------
   */

  session.offeringId =
    resolved.offering.id;

/*
 * --------------------------------------------------
 * Confirm pending appointment
 * --------------------------------------------------
 *
 * This is the final safety boundary before the
 * real provider booking operation.
 *
 * The appointment must already be:
 *
 * - selected
 * - availability-validated
 * - waiting for explicit customer confirmation
 *
 * Only then do we call createBooking().
 */

if (
  isAuthorizedBookingExecution(
    session,
    intent,
    input.currentMessage,
  )
) {

 

  /*
   * Existing appointment execution continues below.
   */

  /*
   * ----------------------------------------------
   * Require a validated slot
   * ----------------------------------------------
   */

  if (
    !session.startAt ||
    !session.endAt
  ) {

    console.error(
      "AI BOOKING CONFIRMATION FAILED: missing validated slot",
      {
        conversationId:
          input.conversationId,

        offeringId:
          session.offeringId,

        startAt:
          session.startAt,

        endAt:
          session.endAt,
      },
    );


    session.status =
      "collecting";


    session.pendingSlotsJson =
      null;


    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {

      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        "I couldn't complete that booking because the selected appointment is no longer available. Let's check the available times again.",

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Create real provider booking
   * ----------------------------------------------
   */

  console.log(
    "AI BOOKING CREATE START",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      offeringId:
        session.offeringId,

      customerId:
        input.customerId,

      startAt:
        session.startAt,

      endAt:
        session.endAt,
    },
  );

  const existingBookingData =
  readSessionData(
    session,
  );

const existingBookingId =
  typeof existingBookingData.bookingId ===
    "string"
    ? existingBookingData.bookingId
    : null;

if (
  existingBookingId
) {

  session.status =
    "confirmed";

  session.updatedAt =
    input.occurredAt;

  await saveSession(
    repository,
    session,
  );

  console.log(
    "AI BOOKING EXECUTION ALREADY COMPLETED",
    {
      tenantId:
        input.context.tenant.id,

      conversationId:
        input.conversationId,

      bookingId:
        existingBookingId,
    },
  );

  return {
      handled:
        true,

      state:
        "confirmed",

      intent,

      message:
        `Your appointment is already confirmed. Your booking reference is ${existingBookingId}.`,

      session,

      actionExecuted:
        false,

      actionResult:
        "none",
    };
}

const executionClaimId =
  crypto.randomUUID();

const executionClaimed =
  await repository.claimBookingExecution(
    input.context.tenant.id,
    input.context.provider,
    input.conversationId,
    executionClaimId,
  );

if (
  !executionClaimed
) {

  console.log(
    "AI BOOKING EXECUTION CLAIMED BY ANOTHER REQUEST",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,
    },
  );

  return {
    handled:
      true,

    state:
      "awaiting_confirmation",

    intent,

    message:
      "Your booking request is already being processed. Please wait a moment.",

    session,

    actionExecuted:
      false,

    actionResult:
      "none",
  };
}


  const booking =
      await createBooking(
        input.context,
        {
          type:
            bookingType,

          offeringId:
            session.offeringId,

          customerId:
            input.customerId,

          start:
            session.startAt,

          end:
            session.endAt,

          adults:
            session.adults ??
            undefined,

          children:
            session.children ??
            undefined,

          quantity:
            session.quantity ??
            undefined,

          resourceId:
            session.resourceId ??
            undefined,

          metadata:
            {
              bookingConversationId:
                input.conversationId,

              bookingSessionStatus:
                session.status,

              bookingType:
                bookingType,
            },
        },
      );

    if (
  !booking?.bookingId
) {

  console.error(
    "AI BOOKING CREATE FAILED: provider returned no booking reference",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      offeringId:
        session.offeringId,

      startAt:
        session.startAt,

      endAt:
        session.endAt,
    },
  );

  session.status =
    "collecting";

  session.pendingSlotsJson =
    null;

  session.updatedAt =
    input.occurredAt;

  await saveSession(
    repository,
    session,
  );

  return {
    handled:
      true,

    state:
      "collecting",

    intent,

    message:
      "I couldn't confirm the appointment with our booking system. Please try again.",

    session,

      actionExecuted:
        false,

      actionResult:
        "failed",
  };
}

/*
 * ----------------------------------------------
 * Verify provider-created booking
 * ----------------------------------------------
 *
 * A booking is not considered successfully created
 * merely because createBooking() returned a booking ID.
 *
 * Re-read the booking from the provider and verify:
 *
 * - the booking exists
 * - it was not immediately cancelled
 * - the offering is the expected offering
 * - the start time matches the validated slot
 * - the end time matches the validated slot
 *
 * This keeps the Core provider-neutral.
 * ----------------------------------------------
 */

const verifiedCreatedBooking =
  await getBooking(
    input.context,

    booking.bookingId,
  );


const providerBookingVerified =
  verifiedCreatedBooking.bookingId ===
    booking.bookingId &&

  verifiedCreatedBooking.status !==
    "cancelled" &&

  verifiedCreatedBooking.offeringId ===
    session.offeringId &&

  verifiedCreatedBooking.start ===
    session.startAt &&

  verifiedCreatedBooking.end ===
    session.endAt;


if (
  !providerBookingVerified
) {

  console.error(
    "AI BOOKING CREATE VERIFICATION FAILED",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        booking.bookingId,

      expectedOfferingId:
        session.offeringId,

      actualOfferingId:
        verifiedCreatedBooking.offeringId,

      expectedStart:
        session.startAt,

      actualStart:
        verifiedCreatedBooking.start,

      expectedEnd:
        session.endAt,

      actualEnd:
        verifiedCreatedBooking.end,

      providerStatus:
        verifiedCreatedBooking.status,
    },
  );


  const failedBookingData =
    readSessionData(
      session,
    );


  failedBookingData.bookingVerification =
    "failed";

  failedBookingData.bookingVerificationAt =
    input.occurredAt;


  session.dataJson =
    JSON.stringify(
      failedBookingData,
    );

  session.status =
    "collecting";

  session.pendingSlotsJson =
    null;

  session.updatedAt =
    input.occurredAt;


  await saveSession(
    repository,

    session,
  );


  return {
    handled:
      true,

    state:
      "collecting",

    intent,

    message:
      "I couldn't verify the appointment with our booking system. Please contact our team before trying again.",

    session,

    actionExecuted:
      true,

    actionResult:
      "failed",

    booking,
  };
}

  /*
   * ----------------------------------------------
   * Persist confirmed state
   * ----------------------------------------------
   */

  const bookingData =
    readSessionData(
      session,
    );


  bookingData.bookingId =
  verifiedCreatedBooking.bookingId;

  bookingData.confirmationCode =
    verifiedCreatedBooking.confirmationCode ??
    verifiedCreatedBooking.bookingId;


  bookingData.confirmedAt =
    input.occurredAt;

  bookingData.actionAudit = {
  action:
    "booking",

  result:
    "success",

  requestedAt:
    bookingData.actionRequestedAt ??
    session.createdAt,

  authorizedAt:
    input.occurredAt,

  executedAt:
    new Date().toISOString(),

  provider:
    input.context.provider,

  bookingId:
  verifiedCreatedBooking.bookingId,

  offeringId:
    verifiedCreatedBooking.offeringId,

  customerId:
    verifiedCreatedBooking.customerId,

  start:
    verifiedCreatedBooking.start,

  end:
    verifiedCreatedBooking.end,
};

  session.dataJson =
    JSON.stringify(
      bookingData,
    );

  session.status =
    "confirmed";


  session.pendingSlotsJson =
    null;

  session.updatedAt =
    input.occurredAt;

  await saveSession(
    repository,

    session,
  );

  console.log(
    "AI BOOKING CREATE SUCCESS",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      bookingId:
        booking.bookingId,

      status:
        booking.status,

      offeringId:
        booking.offeringId,

      customerId:
        booking.customerId,

      start:
        booking.start,

      end:
        booking.end,
    },
  );


  /*
   * ----------------------------------------------
   * Customer confirmation response
   * ----------------------------------------------
   */

  const bookingDate =
    new Intl.DateTimeFormat(
      "en-MY",
      {
        timeZone:
          input.timezone ??
          DEFAULT_TIMEZONE,

        year:
          "numeric",

        month:
          "long",

        day:
          "numeric",
      },
    ).format(
      new Date(
        booking.start,
      ),
    );

  const bookingTime =
    formatSlot(
      {
        start:
          booking.start,

        end:
          booking.end,

        available:
          true,

        offeringId:
          booking.offeringId,

        metadata:
          {},
      },

      input.timezone ??
        DEFAULT_TIMEZONE,
    );

  return {

  handled:
    true,

  state:
    "confirmed",

  intent,

  message:
  bookingType ===
    "accommodation"

    ? `Your accommodation booking is confirmed from ${bookingDate} to ${new Intl.DateTimeFormat(
        "en-MY",
        {
          timeZone:
            input.timezone ??
            DEFAULT_TIMEZONE,

          year:
            "numeric",

          month:
            "long",

          day:
            "numeric",
        },
      ).format(
        new Date(
          booking.end,
        ),
      )}.`

    : `You're all booked. Your appointment is confirmed for ${bookingDate} at ${bookingTime}.`,
  
  session,

  actionExecuted:
    true,

  actionResult:
    "success",

  booking,
};
}

/*
 * ==================================================
 * Accommodation booking flow
 * ==================================================
 *
 * Accommodation is date-range based.
 *
 * Required:
 *
 * - offering
 * - check-in
 * - check-out
 *
 * Optional:
 *
 * - adults
 * - children
 * - quantity
 *
 * This branch must never use appointment slot logic.
 * ==================================================
 */

if (
  bookingType ===
  "accommodation"
) {

  const storedAccommodationStart =
    getStoredString(
      session,
      "accommodationStart",
    );


  const storedAccommodationEnd =
    getStoredString(
      session,
      "accommodationEnd",
    );


  /*
   * Prefer explicit intent values.
   */

  const accommodationStart =
    intent.start ??
    storedAccommodationStart ??
    null;


  const accommodationEnd =
    intent.end ??
    storedAccommodationEnd ??
    null;

  /*
   * Persist explicit accommodation dates.
   */

  const accommodationData =
    readSessionData(
      session,
    );


  if (
    intent.start
  ) {

    accommodationData.accommodationStart =
      intent.start;
  }


  if (
    intent.end
  ) {

    accommodationData.accommodationEnd =
      intent.end;
  }


  if (
    intent.date
  ) {

    accommodationData.checkInDate =
      intent.date;
  }


  session.dataJson =
    JSON.stringify(
      accommodationData,
    );


  /*
   * ------------------------------------------------
   * Require check-in and check-out.
   * ------------------------------------------------
   */

  if (
    !accommodationStart
  ) {

    session.status =
      "collecting";

    session.updatedAt =
      input.occurredAt;

    await saveSession(
      repository,
      session,
    );

    return {
      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        buildAccommodationCheckInPrompt(),

      session,
    };
  }


  if (
    !accommodationEnd
  ) {

    session.status =
      "collecting";

    session.updatedAt =
      input.occurredAt;

    await saveSession(
      repository,
      session,
    );

    return {
      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        buildAccommodationCheckOutPrompt(),

      session,
    };
  }


  /*
   * ------------------------------------------------
   * Validate the date range.
   * ------------------------------------------------
   */

  const accommodationRange =
    buildAccommodationRange(
      accommodationStart,
      accommodationEnd,
    );


  if (
    !accommodationRange
  ) {

    session.status =
      "collecting";

    session.updatedAt =
      input.occurredAt;

    await saveSession(
      repository,
      session,
    );

    return {
      handled:
        true,

      state:
        "collecting",

      intent,

      message:
  "The check-in and check-out dates need to be valid, with check-out after check-in. Please provide the dates again.",
      session,
    };
  }


  /*
   * ------------------------------------------------
   * Persist guest/unit attributes.
   * ------------------------------------------------
   */

  if (
    intent.adults !==
    null
  ) {

    session.adults =
      intent.adults;
  }


  if (
    intent.children !==
    null
  ) {

    session.children =
      intent.children;
  }


  if (
    intent.quantity !==
    null
  ) {

    session.quantity =
      intent.quantity;
  }

  /*
 * ------------------------------------------------
 * Validate accommodation quantities
 * ------------------------------------------------
 */

const accommodationQuantityError =
  validateAccommodationQuantities(
    session.adults,
    session.children,
    session.quantity,
  );


if (
  accommodationQuantityError
) {

  session.status =
    "collecting";

  session.updatedAt =
    input.occurredAt;


  await saveSession(
    repository,
    session,
  );


  return {
    handled:
      true,

    state:
      "collecting",

    intent,

    message:
      accommodationQuantityError,

    session,
  };
}

  const accommodationAvailability =
    await getBookingAvailability(
      input.context,
      {
        type:
          "accommodation",

        offeringId:
          resolved.offering.id,

        start:
          accommodationRange.start,

        end:
          accommodationRange.end,

        timezone:
          input.timezone ??
          DEFAULT_TIMEZONE,

        adults:
          session.adults ??
          undefined,

        children:
          session.children ??
          undefined,

        quantity:
          session.quantity ??
          undefined,
      },
    );


  /*
   * ------------------------------------------------
   * No accommodation availability.
   * ------------------------------------------------
   */

  const availableAccommodation =
    accommodationAvailability.filter(
      (
        slot,
      ) =>
        slot.available !==
        false,
    );


  if (
    availableAccommodation.length ===
    0
  ) {

    session.status =
      "collecting";

    session.startAt =
      null;

    session.endAt =
      null;

    session.updatedAt =
      input.occurredAt;

    await saveSession(
      repository,
      session,
    );

    return {
      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        "I couldn't find availability for those dates. Would you like to try different dates?",

      session,
    };
  }


  /*
   * ------------------------------------------------
   * Use the provider-confirmed date range.
   * ------------------------------------------------
   *
   * For accommodation, the availability result
   * represents the stay itself rather than an
   * appointment slot.
   */

  const selectedAccommodation =
    availableAccommodation.find(
      (
        slot,
      ) =>
        slot.start ===
          accommodationRange.start &&
        slot.end ===
          accommodationRange.end,
    ) ??
    availableAccommodation[0];


  session.startAt =
    selectedAccommodation.start;


  session.endAt =
    selectedAccommodation.end;


  const selectedAccommodationData =
    readSessionData(
      session,
    );


  selectedAccommodationData.accommodationStart =
    selectedAccommodation.start;


  selectedAccommodationData.accommodationEnd =
    selectedAccommodation.end;


  selectedAccommodationData.checkInDate =
    selectedAccommodation.start.slice(
      0,
      10,
    );


  selectedAccommodationData.checkOutDate =
    selectedAccommodation.end.slice(
      0,
      10,
    );


  if (
    selectedAccommodation.price !==
    undefined
  ) {

    selectedAccommodationData.price =
      selectedAccommodation.price;
  }


  if (
    selectedAccommodation.currency
  ) {

    selectedAccommodationData.currency =
      selectedAccommodation.currency;
  }


  session.dataJson =
    JSON.stringify(
      selectedAccommodationData,
    );


  session.pendingSlotsJson =
    JSON.stringify(
      [
        selectedAccommodation,
      ],
    );


  session.status =
    "awaiting_confirmation";


  session.updatedAt =
    input.occurredAt;


  await saveSession(
    repository,
    session,
  );


  console.log(
    "AI ACCOMMODATION AVAILABILITY CONFIRMED",
    {
      tenantId:
        input.context.tenant.id,

      provider:
        input.context.provider,

      conversationId:
        input.conversationId,

      offeringId:
        resolved.offering.id,

      start:
        selectedAccommodation.start,

      end:
        selectedAccommodation.end,

      adults:
        session.adults,

      children:
        session.children,

      quantity:
        session.quantity,
    },
  );


  return {
    handled:
      true,

    state:
      "awaiting_confirmation",

    intent,

    message:
      `The accommodation is available from ${selectedAccommodation.start.slice(
        0,
        10,
      )} to ${selectedAccommodation.end.slice(
        0,
        10,
      )}. Would you like me to confirm this booking?`,

    session,
  };
}

  /*
   * ----------------------------------------------
   * Determine date.
   * ----------------------------------------------
   */

  const storedDate =
    getStoredString(
      session,

      "date",
    );


  const appointmentDate =
    intent.date ??
    storedDate;


  if (
    !appointmentDate
  ) {

    session.status =
      "collecting";


    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {

      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        buildDatePrompt(),

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Determine requested time.
   * ----------------------------------------------
   */

  const storedTime =
    getStoredString(
      session,

      "time",
    );


  const appointmentTime =
  availabilityRefinementRequested
    ? null
    : intent.time ??
      storedTime;


  /*
   * ----------------------------------------------
   * If an explicit start/end was extracted, use it.
   * ----------------------------------------------
   */

  let requestedStart =
  availabilityRefinementRequested
    ? null
    : intent.start ??
      session.startAt ??
      null;


let requestedEnd =
  availabilityRefinementRequested
    ? null
    : intent.end ??
      session.endAt ??
      null;


  /*
   * ----------------------------------------------
   * Build requested time.
   * ----------------------------------------------
   */

  if (
    !requestedStart &&
    appointmentTime
  ) {

    requestedStart =
      localDateTimeToISO(

        appointmentDate,

        appointmentTime,

        input.timezone ??
          DEFAULT_TIMEZONE,
      );
  }


  /*
   * ----------------------------------------------
   * We still need a time.
   * ----------------------------------------------
   */

  if (
    !requestedStart
  ) {

    session.status =
      "collecting";


    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {

      handled:
        true,

      state:
        "collecting",

      intent,

      message:
        buildTimePrompt(),

      session,
    };
  }


  /*
   * ----------------------------------------------
   * Make sure an end exists.
   *
   * The provider may return the final duration when
   * the customer has not provided one.
   *
   * We deliberately query availability without
   * forcing a duration so GHL's configured calendar
   * duration is used.
   * ----------------------------------------------
   */




  /*
   * ----------------------------------------------
   * Availability range.
   * ----------------------------------------------
   */

  const range =
    buildDayRange(

      appointmentDate,

      input.timezone ??
        DEFAULT_TIMEZONE,
    );


  const availability =
    await getBookingAvailability(

      input.context,

      {

        type:
          "appointment",

        offeringId:
          resolved.offering.id,

        start:
          range.start,

        end:
          range.end,

        timezone:
          input.timezone ??
          DEFAULT_TIMEZONE,
      },
    );



  /*
   * ----------------------------------------------
   * Customer selected a slot from previous options.
   * ----------------------------------------------
   */

  if (
    intent.action ===
      "select_slot" &&

    session.status ===
      "awaiting_slot_selection"
  ) {

    const selected =
      resolveSelectedSlot(

        session,

        intent,

        input.timezone ??
          DEFAULT_TIMEZONE,
      );


    if (
      !selected
    ) {

      session.updatedAt =
        input.occurredAt;


      await saveSession(
        repository,

        session,
      );


      return {

        handled:
          true,

        state:
          "awaiting_slot_selection",

        intent,

        message:
          "I couldn't match that selection to one of the available times. Please choose one of the displayed options.",

        session,
      };
    }


    requestedStart =
      selected.start;


    requestedEnd =
      selected.end;

    session.startAt =
      selected.start;


    session.endAt =
      selected.end;

   const selectedBookingData =
  readSessionData(
    session,
  );


selectedBookingData.date =
  new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        input.timezone ??
        DEFAULT_TIMEZONE,

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",
    },
  ).format(
    new Date(
      selected.start,
    ),
  );


selectedBookingData.time =
  formatSlot(
    selected,

    input.timezone ??
      DEFAULT_TIMEZONE,
  );


selectedBookingData.start =
  selected.start;


selectedBookingData.end =
  selected.end;


session.dataJson =
  JSON.stringify(
    selectedBookingData,
  );


    session.pendingSlotsJson =
      JSON.stringify(
        [selected],
      );


    session.status =
      "awaiting_confirmation";


    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    return {

      handled:
        true,

      state:
        "awaiting_confirmation",

      intent,

      message:
        buildConfirmationMessage(

          resolved.offering.name,

          selected,

          input.timezone ??
            DEFAULT_TIMEZONE,
        ),

      session,
    };
  }


  /*
 * ----------------------------------------------
 * Customer gave a direct time.
 *
 * Match it against real provider availability.
 * ----------------------------------------------
 */

if (
  appointmentTime
) {

  const selected =
    resolveSelectedSlotFromAvailability(
      availability,

      appointmentTime,

      input.timezone ??
        DEFAULT_TIMEZONE,
    );

    


  /*
   * ----------------------------------------------
   * Requested time is unavailable.
   *
   * Do not display a list of slots.
   * Find only the next available slot.
   * ----------------------------------------------
   */

  if (
    !selected
  ) {

    const requestedTimestamp =
      new Date(
        requestedStart,
      ).getTime();


    const nextAvailableSlot =
      availability
        .filter(
          (
            slot,
          ) =>
            slot.available !==
              false &&

            !Number.isNaN(
              new Date(
                slot.start,
              ).getTime(),
            ) &&

            new Date(
              slot.start,
            ).getTime() >
              requestedTimestamp,
        )
        .sort(
          (
            a,
            b,
          ) =>
            new Date(
              a.start,
            ).getTime() -
            new Date(
              b.start,
            ).getTime(),
        )[0] ??
      null;


    /*
     * --------------------------------------------
     * No later slot exists on this date.
     * --------------------------------------------
     */

    if (
      !nextAvailableSlot
    ) {

      const bookingData =
        readSessionData(
          session,
        );


      delete bookingData.time;

      delete bookingData.start;

      delete bookingData.end;


      session.startAt =
        null;

      session.endAt =
        null;

      session.pendingSlotsJson =
        null;

      session.dataJson =
        JSON.stringify(
          bookingData,
        );

      session.status =
        "collecting";

      session.updatedAt =
        input.occurredAt;


      await saveSession(
        repository,

        session,
      );


      return {
        handled:
          true,

        state:
          "collecting",

        intent,

        message:
          `That time isn't available on ${appointmentDate}, and there are no later available times on that date. Please choose another time or date.`,

        session,
      };
    }


    /*
     * --------------------------------------------
     * Store only the next available slot.
     * --------------------------------------------
     */

    requestedStart =
      nextAvailableSlot.start;


    requestedEnd =
      nextAvailableSlot.end;


    session.startAt =
      nextAvailableSlot.start;


    session.endAt =
      nextAvailableSlot.end;


    const bookingData =
      readSessionData(
        session,
      );


    bookingData.time =
      formatSlot(
        nextAvailableSlot,

        input.timezone ??
          DEFAULT_TIMEZONE,
      );


    bookingData.start =
      nextAvailableSlot.start;


    bookingData.end =
      nextAvailableSlot.end;


    session.dataJson =
      JSON.stringify(
        bookingData,
      );


    session.pendingSlotsJson =
      JSON.stringify(
        [
          nextAvailableSlot,
        ],
      );


    session.status =
      "awaiting_confirmation";


    session.updatedAt =
      input.occurredAt;


    await saveSession(
      repository,

      session,
    );


    console.log(
      "AI BOOKING REQUESTED TIME UNAVAILABLE",
      {
        tenantId:
          input.context.tenant.id,

        provider:
          input.context.provider,

        conversationId:
          input.conversationId,

        requestedTime:
          appointmentTime,

        requestedStart,

        nextAvailableStart:
          nextAvailableSlot.start,

        nextAvailableEnd:
          nextAvailableSlot.end,
      },
    );


    return {
      handled:
        true,

      state:
        "awaiting_confirmation",

      intent,

      message:
        `That time isn't available on ${appointmentDate}. The next available time is ${formatSlot(
          nextAvailableSlot,
          input.timezone ??
            DEFAULT_TIMEZONE,
        )}. Would you like me to book that time?`,

      session,
    };
  }


    /*
   * ----------------------------------------------
   * Exact requested time is available.
   * ----------------------------------------------
   */

  requestedStart =
    selected.start;

  requestedEnd =
    selected.end;

  session.startAt =
    selected.start;

  session.endAt =
    selected.end;

  const selectedBookingData =
    readSessionData(
      session,
    );

  selectedBookingData.date =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          input.timezone ??
          DEFAULT_TIMEZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    ).format(
      new Date(
        selected.start,
      ),
    );

  selectedBookingData.time =
    formatSlot(
      selected,

      input.timezone ??
        DEFAULT_TIMEZONE,
    );

  selectedBookingData.start =
    selected.start;

  selectedBookingData.end =
    selected.end;

  session.dataJson =
    JSON.stringify(
      selectedBookingData,
    );

  session.pendingSlotsJson =
    JSON.stringify(
      [
        selected,
      ],
    );

  session.status =
    "awaiting_confirmation";

  session.updatedAt =
    input.occurredAt;

  await saveSession(
    repository,

    session,
  );

  return {
    handled:
      true,

    state:
      "awaiting_confirmation",

    intent,

    message:
      buildConfirmationMessage(
        resolved.offering.name,

        selected,

        input.timezone ??
          DEFAULT_TIMEZONE,
      ),

    session,
  };
}


/*
 * ----------------------------------------------
 * No direct time was provided.
 *
 * Ask the customer for the time instead of
 * suggesting available appointment slots.
 * ----------------------------------------------
 */

session.startAt =
  null;

session.endAt =
  null;

session.pendingSlotsJson =
  null;

session.status =
  "collecting";

session.updatedAt =
  input.occurredAt;

await saveSession(
  repository,

  session,
);

return {
  handled:
    true,

  state:
    "collecting",

  intent,

  message:
    buildTimePrompt(),

  session,
};
}


/*
 * --------------------------------------------------
 * Find slot from actual availability
 * --------------------------------------------------
 */

function resolveSelectedSlotFromAvailability(
  slots:
    BookingAvailabilitySlot[],

  requestedTime:
    string,

  timezone:
    string,
):
  BookingAvailabilitySlot |
  null {

  const normalized =
    requestedTime
      .trim()
      .toLowerCase()
      .replace(
        /\s/g,
        "",
      );


  if (
    !normalized
  ) {

    return null;
  }


  for (
    const slot of
      slots
  ) {

    const start =
      new Date(
        slot.start,
      );


    if (
      Number.isNaN(
        start.getTime(),
      )
    ) {

      continue;
    }


    const twentyFourHour =
      new Intl.DateTimeFormat(
        "en-GB",
        {
          timeZone:
            timezone,

          hour:
            "2-digit",

          minute:
            "2-digit",

          hour12:
            false,
        },
      )
      .format(
        start,
      )
      .replace(
        /\s/g,
        "",
      );


    const normalizedTwentyFourHour =
  twentyFourHour
    .replace(
      /^0(\d):/,
      "$1:",
    );


if (
  normalizedTwentyFourHour ===
  normalized
) {

      return slot;
    }


    const twelveHour =
      formatSlot(
        slot,

        timezone,
      )
        .toLowerCase()
        .replace(
          /\s/g,
          "",
        );


    if (
      twelveHour ===
      normalized
    ) {

      return slot;
    }
  }


  return null;
}