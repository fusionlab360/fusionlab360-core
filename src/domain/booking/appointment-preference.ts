const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function localDate(occurredAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(occurredAt));
}

function validDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
    ? `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
    : null;
}

function resolveNamedDate(message: string, occurredAt: string, timezone: string): { value: string | null; invalid: boolean } {
  const current = localDate(occurredAt, timezone);
  const [currentYear] = current.split("-").map(Number);
  const named = message.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{2,4}))?\b/i)
    ?? message.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{2,4}))?\b/i);
  if (named) {
    const dayFirst = /^\d/.test(named[0]);
    const day = Number(dayFirst ? named[1] : named[2]);
    const month = MONTHS.indexOf((dayFirst ? named[2] : named[1]).toLowerCase()) + 1;
    const suppliedYear = named[3];
    const year = suppliedYear ? (suppliedYear.length === 2 ? 2000 + Number(suppliedYear) : Number(suppliedYear)) : currentYear;
    const value = validDate(year, month, day);
    if (!value) return { value: null, invalid: true };
    if (!suppliedYear && value < current) return { value: validDate(currentYear + 1, month, day), invalid: false };
    return { value, invalid: false };
  }
  const relative = message.match(/\b(today|tomorrow)\b/i);
  if (relative) {
    const base = new Date(`${current}T12:00:00Z`);
    if (relative[1].toLowerCase() === "tomorrow") base.setUTCDate(base.getUTCDate() + 1);
    return { value: base.toISOString().slice(0, 10), invalid: false };
  }
  const weekday = message.match(/\bnext\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i);
  if (weekday) {
    const base = new Date(`${current}T12:00:00Z`);
    const target = WEEKDAYS.indexOf(weekday[1].toLowerCase());
    let delta = (target - base.getUTCDay() + 7) % 7;
    if (delta === 0) delta = 7;
    base.setUTCDate(base.getUTCDate() + delta);
    return { value: base.toISOString().slice(0, 10), invalid: false };
  }
  return { value: null, invalid: false };
}

/** Parse only date/time details actually supplied by the patient. */
export function parseAppointmentPreference(message: string, occurredAt: string, timezone: string): {
  date: string | null;
  time: string | null;
  error: string | null;
} {
  const dates: string[] = [];
  let invalidDate = false;
  for (const match of message.matchAll(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g)) {
    const year = match[1] ? Number(match[1]) : (match[6].length === 2 ? 2000 + Number(match[6]) : Number(match[6]));
    const month = match[1] ? Number(match[2]) : Number(match[5]);
    const day = match[1] ? Number(match[3]) : Number(match[4]);
    const value = validDate(year, month, day);
    if (value) dates.push(value); else invalidDate = true;
  }
  const named = resolveNamedDate(message, occurredAt, timezone);
  if (named.value) dates.push(named.value);
  invalidDate ||= named.invalid;

  const times: string[] = [];
  let ambiguousTime = false;
  for (const match of message.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/gi)) {
    let hour = Number(match[1] ?? match[4]);
    const minute = Number(match[2] ?? match[5] ?? 0);
    if (match[3]) {
      if (hour < 1 || hour > 12) return { date: dates[0] ?? null, time: null, error: "Please provide a valid preferred time." };
      hour = hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
    }
    if (hour > 23 || minute > 59) return { date: dates[0] ?? null, time: null, error: "Please provide a valid preferred time." };
    times.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  const atTime = message.match(/\bat\s+(\d{1,2})/i);
  if (atTime && !new RegExp(`\\bat\\s+${atTime[1]}\\s*(?:am|pm|:)`, "i").test(message)) ambiguousTime = true;
  const date = dates.length === 1 ? dates[0] : null;
  const time = times.length === 1 ? times[0] : null;
  if (dates.length > 1 || times.length > 1 || invalidDate) return { date, time, error: "Please provide one valid preferred date and time." };
  if (!date && /\bnext week\b/i.test(message)) return { date, time, error: "Please clarify the appointment date." };
  if (ambiguousTime) return { date, time, error: "What time would you prefer, including AM or PM?" };
  if (!date && /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b|\d{1,2}[/-]\d{1,2}/i.test(message)) return { date, time, error: "Please clarify the appointment date." };
  if (!time && /\b(?:at\s+\d|morning|afternoon|evening|noon|night)\b/i.test(message)) return { date, time, error: "What time would you prefer, including AM or PM?" };
  return { date, time, error: null };
}

/** Reject nonexistent or ambiguous local times instead of assuming UTC or a DST offset. */
export function appointmentLocalTimeToISO(date: string, time: string, timezone: string): string | null {
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target)) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const matches: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = new Date(target + offset * 60_000);
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time) matches.push(instant.toISOString());
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}
