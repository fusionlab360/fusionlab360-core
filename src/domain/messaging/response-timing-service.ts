/*
 * --------------------------------------------------
 * Messaging response timing
 * --------------------------------------------------
 *
 * Provider-neutral timing helpers.
 *
 * These delays are intentionally small and are used
 * only to make AI conversation flow feel less robotic.
 *
 * No GHL-specific behavior belongs here.
 */


/*
 * --------------------------------------------------
 * Timing ranges
 * --------------------------------------------------
 */

const AI_THINKING_MIN_MS =
  1200;

const AI_THINKING_MAX_MS =
  2200;

const AI_DELIVERY_MIN_MS =
  500;

const AI_DELIVERY_MAX_MS =
  1500;


/*
 * --------------------------------------------------
 * Sleep
 * --------------------------------------------------
 */

export function sleep(
  milliseconds:
    number,
): Promise<void> {

  return new Promise(
    (
      resolve,
    ) =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );
}


/*
 * --------------------------------------------------
 * Random range
 * --------------------------------------------------
 */

function randomBetween(
  min:
    number,

  max:
    number,
): number {

  return (
    Math.floor(
      Math.random() *
      (
        max -
        min +
        1
      ),
    ) +
    min
  );
}


/*
 * --------------------------------------------------
 * AI thinking delay
 * --------------------------------------------------
 *
 * This happens BEFORE knowledge retrieval and
 * generation.
 *
 * It provides a short debounce window so multiple
 * customer messages arriving close together can be
 * considered as one conversational turn.
 */

export function calculateAIThinkingDelay():
  number {

  return randomBetween(
    AI_THINKING_MIN_MS,
    AI_THINKING_MAX_MS,
  );
}


/*
 * --------------------------------------------------
 * AI delivery delay
 * --------------------------------------------------
 *
 * This happens AFTER generation and BEFORE sending.
 *
 * Longer responses receive a slightly longer pause.
 */

export function calculateAIDeliveryDelay(
  reply:
    string,
): number {

  const length =
    reply.trim().length;


  let baseDelay: number;


  if (
    length <= 60
  ) {

    baseDelay =
      500;

  } else if (
    length <= 140
  ) {

    baseDelay =
      800;

  } else if (
    length <= 240
  ) {

    baseDelay =
      1100;

  } else {

    baseDelay =
      1300;
  }


  const jitter =
    randomBetween(
      0,
      200,
    );


  return Math.min(
    baseDelay + jitter,

    AI_DELIVERY_MAX_MS,
  );
}