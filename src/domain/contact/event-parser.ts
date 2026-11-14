import type {
  ContactEvent,
} from "./event";


const NOTE_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function normalizeNotes(
  notes:
    string,
): string {

  return notes
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    /*
     * Convert paragraph / line-break HTML into
     * actual newline boundaries.
     */
    .replace(
      /<\/?(?:p|div|li|ul|ol|blockquote|section|article|h[1-6]|tr|td|th|pre)(?:\s[^>]*)?>/gi,
      "\n",
    )
    .replace(
      /<br\b[^>]*>/gi,
      "\n",
    )

    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity, key: string) => {
      if (!key.startsWith("#")) return NOTE_ENTITIES[key.toLowerCase()] ?? entity;
      const hex = key[1]?.toLowerCase() === "x";
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : entity;
    })
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

export function parseContactEventSnapshot(notes: unknown, options?: { clinic: true }): ContactEventSnapshot {
  if (notes === undefined) return { kind: "omitted" };
  if (typeof notes !== "string") return { kind: "malformed" };

  const value = normalizeNotes(notes);
  if (!value) return { kind: "blank" };

  if (/[^\s\d]\d{2}\/\d{2}\/(?:\d{4}|\d{2})(?=[^\S\n]*-)/.test(value)) {
    return { kind: "malformed" };
  }
  // A second entry marker on the same line may mean a paragraph break was lost.
  if (options?.clinic && value.split("\n").some((line) =>
    /\S[^\n]*?[^\S\n]+\d{2}\/\d{2}\/(?:\d{4}|\d{2})[^\S\n]*-/.test(line))) {
    return { kind: "malformed" };
  }
  const entries = Array.from(value.matchAll(options?.clinic
    ? /^[^\S\n]*(\d+[^\S\n]*[/.\-][^\S\n]*\d+(?:[^\S\n]*[/.\-][^\S\n]*\d+)?)(?=\D|$)/gm
    :
    /(?:^|\s)(\d+\s*[/.\-]\s*\d+(?:\s*[/.\-]\s*\d+)?)(?=\D|$)/g,
  ));
  if (!entries.length) return { kind: "undated" };
  if (!options?.clinic && value.slice(0, entries[0].index).trim()) return { kind: "malformed" };

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
  const uniqueEvents = new Map(events.map((event) => [JSON.stringify([event.date, event.type]), event]));
  return { kind: "complete", events: Array.from(uniqueEvents.values()) };
}

export function parseContactEvents(notes: string | undefined): ContactEvent[] {
  const snapshot = parseContactEventSnapshot(notes);
  return snapshot.kind === "complete" ? snapshot.events : [];
}
