import type {
  AIProvider,
} from "../../core/ai";


import type {
  MessagingMessage,
} from "../../core/messaging";


import type {
  AIBookingSession,
} from "../../persistence/repositories/ai-booking-session-repository";


/*
 * --------------------------------------------------
 * Booking intent
 * --------------------------------------------------
 */

export type BookingIntentAction =
  | "none"
  | "start"
  | "continue"
  | "select_slot"
  | "confirm"
  | "cancel";


export type BookingIntentType =
  | "appointment"
  | "accommodation"
  | null;


export interface BookingIntent {

  action:
    BookingIntentAction;

  bookingType:
    BookingIntentType;

  offeringQuery:
    string |
    null;

  branchQuery:
    string |
    null;

  resourceQuery:
    string |
    null;

  date:
    string |
    null;

  time:
    string |
    null;

  start:
    string |
    null;

  end:
    string |
    null;

  adults:
    number |
    null;

  children:
    number |
    null;

  quantity:
    number |
    null;

  slotNumber:
    number |
    null;

  confidence:
    number;

  reason:
    string;
}


/*
 * --------------------------------------------------
 * Empty intent helper
 * --------------------------------------------------
 */

function emptyBookingIntent(
  reason:
    string,
): BookingIntent {

  return {

    action:
      "none",

    bookingType:
      null,

    offeringQuery:
      null,

    branchQuery:
      null,

    resourceQuery:
      null,

    date:
      null,

    time:
      null,

    start:
      null,

    end:
      null,

    adults:
      null,

    children:
      null,

    quantity:
      null,

    slotNumber:
      null,

    confidence:
      0,

    reason,
  };
}


/*
 * --------------------------------------------------
 * Extract JSON object from model response
 * --------------------------------------------------
 */

function extractJSONObject(
  text:
    string,
):
  string |
  null {

  const trimmed =
    text.trim();


  if (
    !trimmed
  ) {

    return null;
  }


  /*
   * Direct JSON
   */

  if (
    trimmed.startsWith("{") &&
    trimmed.endsWith("}")
  ) {

    return trimmed;
  }


  /*
   * Markdown JSON block
   */

  const fenced =
    trimmed.match(
      /```(?:json)?\s*([\s\S]*?)\s*```/i,
    );


  if (
    fenced?.[1]
  ) {

    const candidate =
      fenced[1].trim();


    if (
      candidate.startsWith("{") &&
      candidate.endsWith("}")
    ) {

      return candidate;
    }
  }


  /*
   * JSON object embedded in text
   */

  const first =
    trimmed.indexOf(
      "{",
    );


  const last =
    trimmed.lastIndexOf(
      "}",
    );


  if (
    first >= 0 &&
    last > first
  ) {

    return trimmed.slice(
      first,
      last + 1,
    );
  }


  return null;
}


/*
 * --------------------------------------------------
 * Nullable string
 * --------------------------------------------------
 */

function nullableString(
  value:
    unknown,
):
  string |
  null {

  if (
    typeof value !==
    "string"
  ) {

    return null;
  }


  const normalized =
    value.trim();


  return normalized
    ? normalized
    : null;
}


/*
 * --------------------------------------------------
 * Nullable number
 * --------------------------------------------------
 */

function nullableNumber(
  value:
    unknown,
):
  number |
  null {

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
 * Normalize booking intent
 * --------------------------------------------------
 */

function normalizeBookingIntent(
  value:
    unknown,
):
  BookingIntent {

  const input =
    (
      value &&
      typeof value ===
        "object"
    )

      ? value as Record<
          string,
          unknown
        >

      : {};


  const rawAction =
    nullableString(
      input.action,
    );


  const allowedActions:
    BookingIntentAction[] =
    [
      "none",
      "start",
      "continue",
      "select_slot",
      "confirm",
      "cancel",
    ];


  const action =
    allowedActions.includes(
      rawAction as
        BookingIntentAction,
    )

      ? rawAction as
          BookingIntentAction

      : "none";


  const rawType =
    nullableString(
      input.bookingType,
    );


  const bookingType:
    BookingIntentType =
    rawType ===
      "appointment"

      ? "appointment"

      : rawType ===
          "accommodation"

        ? "accommodation"

        : null;


  const confidence =
    nullableNumber(
      input.confidence,
    ) ??
    0;


  return {

    action,

    bookingType,

    offeringQuery:
      nullableString(
        input.offeringQuery,
      ),

    branchQuery:
      nullableString(
        input.branchQuery,
      ),

    resourceQuery:
      nullableString(
        input.resourceQuery,
      ),

    date:
      nullableString(
        input.date,
      ),

    time:
      nullableString(
        input.time,
      ),

    start:
      nullableString(
        input.start,
      ),

    end:
      nullableString(
        input.end,
      ),

    adults:
      nullableNumber(
        input.adults,
      ),

    children:
      nullableNumber(
        input.children,
      ),

    quantity:
      nullableNumber(
        input.quantity,
      ),

    slotNumber:
      nullableNumber(
        input.slotNumber,
      ),

    confidence:
      Math.max(
        0,
        Math.min(
          1,
          confidence,
        ),
      ),

    reason:
      nullableString(
        input.reason,
      ) ??
      "",
  };
}


/*
 * --------------------------------------------------
 * Build recent conversation context
 * --------------------------------------------------
 */

function buildHistoryContext(
  history:
    MessagingMessage[],
):
  string {

  return history
    .filter(
      (
        item,
      ) =>
        item.text
          .trim()
          .length >
          0 &&

        item.senderType !==
          "system",
    )
    .sort(
      (
        a,
        b,
      ) =>
        new Date(
          a.timestamp,
        ).getTime() -

        new Date(
          b.timestamp,
        ).getTime(),
    )
    .slice(
      -12,
    )
    .map(
      (
        item,
      ) => {

        const speaker =
          item.senderType ===
            "customer"

            ? "CUSTOMER"

            : item.senderType ===
                "human"

              ? "TEAM"

              : "ASSISTANT";


        return `${speaker}: ${item.text}`;
      },
    )
    .join(
      "\n",
    );
}


/*
 * --------------------------------------------------
 * Extract booking intent
 * --------------------------------------------------
 *
 * This is intentionally separate from the normal
 * customer-facing AI response generator.
 *
 * It produces structured booking intent only.
 * --------------------------------------------------
 */

export async function extractBookingIntent(
  ai:
    AIProvider,

  history:
    MessagingMessage[],

  currentMessage:
    string,

  occurredAt:
    string,

  existingSession:
    AIBookingSession |
    null,
):
  Promise<
    BookingIntent
  > {

  const historyContext =
    buildHistoryContext(
      history,
    );


  const existingSessionContext =
    existingSession

      ? JSON.stringify({

          status:
            existingSession.status,

          bookingType:
            existingSession.bookingType,

          offeringId:
            existingSession.offeringId,

          resourceId:
            existingSession.resourceId,

          startAt:
            existingSession.startAt,

          endAt:
            existingSession.endAt,

          adults:
            existingSession.adults,

          children:
            existingSession.children,

          quantity:
            existingSession.quantity,

        })

      : "null";


  /*
   * ------------------------------------------------
   * Structured extraction prompt
   * ------------------------------------------------
   */

  const systemPrompt = `
You are a booking intent extraction engine inside FusionLab360 Core.

Your job is NOT to answer the customer.

Your job is to convert the customer's latest message and recent conversation into structured booking intent.

Current timestamp:
${occurredAt}

Existing booking session:
${existingSessionContext}

Recent conversation:
${historyContext || "(none)"}

Latest customer message:
${currentMessage}

Return ONLY valid JSON.

Use exactly this structure:

{
  "action": "none|start|continue|select_slot|confirm|cancel",
  "bookingType": "appointment|accommodation|null",
  "offeringQuery": "string|null",
  "branchQuery": "string|null",
  "resourceQuery": "string|null",
  "date": "YYYY-MM-DD|null",
  "time": "HH:mm|null",
  "start": "ISO-8601|null",
  "end": "ISO-8601|null",
  "adults": "number|null",
  "children": "number|null",
  "quantity": "number|null",
  "slotNumber": "number|null",
  "confidence": 0.0,
  "reason": "brief reason"
}

Rules:

1. action = "none"
   when the customer is only asking a normal business question and is not trying to book.

2. action = "start"
   when the customer clearly wants to make a new booking.

3. action = "continue"
   when an existing booking session is being completed or updated.

4. action = "select_slot"
   when the customer selects one of the offered booking slots.
   Use slotNumber when the customer clearly selects by number.
   Otherwise provide time when possible.

5. action = "confirm"
   only when the customer clearly confirms the exact booking currently being presented.

6. action = "cancel"
   when the customer clearly cancels the booking process.

7. appointment:
   - date is the appointment date
   - start/end are appointment timestamps when confidently known
   - adults/children may remain null

8. accommodation:
   - date is check-in date
   - start is check-in timestamp when possible
   - end is check-out timestamp when possible
   - adults and children should be captured when stated
   - quantity means number of rooms when stated

9. Resolve relative dates from the current timestamp.
   Example: "tomorrow" becomes the next calendar date.

10. Never invent values that are not supported by the conversation.

11. Do not invent calendar IDs, room IDs, service IDs, provider IDs, prices, or availability.

12. confidence must reflect how clearly the customer's message indicates the booking action.

13. If there is no booking intent, return action "none".

Return JSON only.
`.trim();


  /*
   * ------------------------------------------------
   * Ask AI provider
   * ------------------------------------------------
   */

  try {

    const response =
      await ai.chat({

        messages: [

          {
            role:
              "system",

            content:
              systemPrompt,
          },

          {
            role:
              "user",

            content:
              currentMessage,
          },

        ],

        maxTokens:
          500,

        temperature:
          0,
      });


    /*
     * ----------------------------------------------
     * Diagnostic logging
     * ----------------------------------------------
     */

    console.log(
      "BOOKING INTENT RAW AI RESPONSE",
      {

        responseLength:
          response.text?.length ??
          0,

        response:
          response.text,
      },
    );


    /*
     * ----------------------------------------------
     * Extract JSON
     * ----------------------------------------------
     */

    const json =
      extractJSONObject(
        response.text,
      );


    if (
      !json
    ) {

      console.error(
        "BOOKING INTENT JSON EXTRACTION FAILED",
        {

          response:
            response.text,
        },
      );


      return emptyBookingIntent(
        "AI did not return a JSON object.",
      );
    }


    /*
     * ----------------------------------------------
     * Parse JSON
     * ----------------------------------------------
     */

    let parsed:
      unknown;


    try {

      parsed =
        JSON.parse(
          json,
        );

    } catch (
      error:
        unknown
    ) {

      console.error(
        "BOOKING INTENT JSON PARSE FAILED",
        {

          json,

          error:
            error instanceof Error
              ? error.message
              : error,
        },
      );


      return emptyBookingIntent(
        "AI returned invalid JSON.",
      );
    }


    /*
     * ----------------------------------------------
     * Normalize structure
     * ----------------------------------------------
     */

    return normalizeBookingIntent(
      parsed,
    );

  } catch (
    error:
      unknown
  ) {

    /*
     * ----------------------------------------------
     * AI provider failure
     * ----------------------------------------------
     */

    console.error(
      "BOOKING INTENT AI REQUEST FAILED",
      {

        currentMessage,

        error:
          error instanceof Error
            ? {
                name:
                  error.name,

                message:
                  error.message,

                stack:
                  error.stack ??
                  null,
              }

            : error,
      },
    );


    return emptyBookingIntent(
      "AI booking intent request failed.",
    );
  }
}