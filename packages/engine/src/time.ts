/** Offset (ms) of `timeZone` from UTC at `at`. */
function tzOffsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The wall-clock date (y, m, d) in a time zone. */
function localDate(timeZone: string, at: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Epoch ms for a wall-clock time on the local date of `now` in `timeZone`. */
function wallClock(timeZone: string, now: number, hour: number, minute: number): number {
  const { y, m, d } = localDate(timeZone, now);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const off = tzOffsetMs(timeZone, guess);
  let at = guess - off;
  const off2 = tzOffsetMs(timeZone, at);
  if (off2 !== off) at = guess - off2;
  return at;
}

/**
 * Understands "7pm", "7:30 pm", "19:00", "in 90 minutes", "in an hour", "in 1.5 hours",
 * "noon" and ISO timestamps. Times earlier than now roll over to tomorrow.
 * Returns epoch milliseconds, or null when the text isn't a time.
 */
export function parseServeTime(text: string, now: number, timeZone = "UTC"): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}t/.test(t)) {
    const v = Date.parse(text);
    return Number.isNaN(v) ? null : v;
  }
  const rel = t.match(/^in\s+(?:about\s+)?(an?|\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/);
  if (rel) {
    const n = rel[1] === "a" || rel[1] === "an" ? 1 : Number(rel[1].replace(",", "."));
    const mult = rel[2].startsWith("h") ? 3600000 : 60000;
    return Math.ceil((now + Math.round(n * mult)) / 60000) * 60000;
  }
  if (/^in\s+half\s+an\s+hour/.test(t)) return Math.ceil((now + 30 * 60000) / 60000) * 60000;

  let hour: number | null = null;
  let minute = 0;
  let meridiem: string | undefined;
  if (/\bnoon\b/.test(t)) hour = 12;
  else if (/\bmidnight\b/.test(t)) hour = 0;
  const m = t.match(/(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (hour === null && m) {
    hour = Number(m[1]);
    minute = m[2] ? Number(m[2]) : 0;
    meridiem = m[3]?.replace(/\./g, "");
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  if (hour === null || hour > 23 || minute > 59) return null;
  // "7" or "7:30" without am/pm: the next time the clock shows it (dinner at 5 pm → 7:30 pm).
  const candidates = [hour];
  if (!meridiem && hour >= 1 && hour <= 11) candidates.push(hour + 12);
  for (const h of candidates) {
    const at = wallClock(timeZone, now, h, minute);
    if (at > now) return at;
  }
  return wallClock(timeZone, now + 86400000, candidates[0], minute);
}
