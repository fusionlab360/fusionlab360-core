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


export type ContactEventSnapshot =
  | { kind: "omitted" | "blank" | "undated" | "malformed" }
  | { kind: "complete"; events: ContactEvent[] };

export function parseContactEventSnapshot(notes: unknown): ContactEventSnapshot {
  if (notes === undefined) return { kind: "omitted" };
  if (typeof notes !== "string") return { kind: "malformed" };

  const value = normalizeNotes(notes);
  if (!value) return { kind: "blank" };

  // Find candidate boundaries separately from validation so a bad date or
  // missing delimiter cannot disappear from a destructive replacement.
  const entries = Array.from(value.matchAll(
    /(?:^|\s)(\d+\s*[/.\-]\s*\d+(?:\s*[/.\-]\s*\d+)?)(?=\D|$)/g,
  ));
  if (!entries.length) return { kind: "undated" };
  if (value.slice(0, entries[0].index).trim()) return { kind: "malformed" };

  const events: ContactEvent[] = [];
  for (const [index, entry] of entries.entries()) {
    const date = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(entry[1]);
    const content = value.slice(entry.index + entry[0].length, entries[index + 1]?.index);
    const body = /^\s*-/.test(content) ? content.replace(/^\s*-/, "").trim() : "";
    if (!date || !body) return { kind: "malformed" };

    const [, day, month, rawYear] = date;
    const year = Number(rawYear) + (rawYear.length === 2 ? 2000 : 0);
    const parsed = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== Number(month) - 1 ||
      parsed.getUTCDate() !== Number(day)
    ) {
      return { kind: "malformed" };
    }

    events.push({
      date: `${String(year).padStart(4, "0")}-${month}-${day}`,
      type: body.split("\n")
        .map((line) => line.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .join("\n"),
    });
  }
  return { kind: "complete", events };
}

export function parseContactEvents(notes: string | undefined): ContactEvent[] {
  const snapshot = parseContactEventSnapshot(notes);
  return snapshot.kind === "complete" ? snapshot.events : [];
}
