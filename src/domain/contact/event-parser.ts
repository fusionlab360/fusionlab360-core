import type {
  ContactEvent,
} from "./event";


function normalizeNotes(
  notes:
    string,
): string {

  return notes
    /*
     * Convert paragraph / line-break HTML into
     * actual newline boundaries.
     */
    .replace(
      /<\/p\s*>/gi,
      "\n",
    )
    .replace(
      /<br\s*\/?>/gi,
      "\n",
    )

    /*
     * Decode common HTML entities used by editors.
     */
    .replace(
      /&nbsp;/gi,
      " ",
    )
    .replace(
      /&amp;/gi,
      "&",
    )
    .replace(
      /&lt;/gi,
      "<",
    )
    .replace(
      /&gt;/gi,
      ">",
    )

    /*
     * Remove remaining HTML tags.
     */
    .replace(
      /<[^>]+>/g,
      " ",
    )

    /*
     * Normalize whitespace.
     */
    .replace(
      /\r\n/g,
      "\n",
    )
    .replace(
      /\r/g,
      "\n",
    )
    .trim();
}


export function parseContactEvents(
  notes:
    string | undefined,
): ContactEvent[] {

  if (
    !notes?.trim()
  ) {
    return [];
  }


  const value =
    normalizeNotes(
      notes,
    );


  if (!value) {
    return [];
  }


  const events:
    ContactEvent[] = [];


  /*
   * Supports:
   *
   * 29/09/26 - follow up
   * 29/09/2026 - follow up
   *
   * It also supports multiple events on one line
   * because each new date starts another event.
   */

  const eventPattern =
    /(\d{2})\/(\d{2})\/(\d{2}|\d{4})\s*-\s*(.*?)(?=\s*\d{2}\/\d{2}\/(?:\d{2}|\d{4})\s*-\s*|$)/g;


  let match:
    RegExpExecArray | null;


  while (
    (
      match =
        eventPattern.exec(
          value,
        )
    ) !== null
  ) {

    const [
      ,
      day,
      month,
      rawYear,
      rawType,
    ] =
      match;


    let year =
      Number(
        rawYear,
      );


    /*
     * 26 → 2026
     * 27 → 2027
     */

    if (
      rawYear.length ===
      2
    ) {

      year +=
        2000;
    }


    const dayNumber =
      Number(
        day,
      );


    const monthNumber =
      Number(
        month,
      );


    /*
     * Validate actual calendar date.
     */

    const parsedDate =
      new Date(
        year,
        monthNumber - 1,
        dayNumber,
      );


    if (
      parsedDate.getFullYear() !==
        year ||

      parsedDate.getMonth() !==
        monthNumber - 1 ||

      parsedDate.getDate() !==
        dayNumber
    ) {

      continue;
    }


    const eventType =
      rawType
        .trim()
        .replace(
          /\s+/g,
          " ",
        );


    if (!eventType) {
      continue;
    }


    events.push({
      date:
        `${year}-${month}-${day}`,

      type:
        eventType,
    });
  }


  return events;
}