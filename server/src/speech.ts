import { clock, type NowView, type Plan, type PlannedStep } from "../../packages/engine/src/index.ts";

/** "a, b and c" */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Lowercases the first letter so a label reads well mid-sentence. */
function mid(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function minutes(n: number): string {
  if (n <= 0) return "now";
  if (n === 1) return "1 minute";
  if (n < 60) return `${n} minutes`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hs = h === 1 ? "1 hour" : `${h} hours`;
  return m ? `${hs} ${m} minutes` : hs;
}

/** "tomorrow " when `at` falls on the day after `now` in `timeZone`, otherwise "". */
function tomorrow(at: number, now: number, timeZone: string): string {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  return day(at) !== day(now) && day(at) === day(now + 86400000) ? "tomorrow " : "";
}

/** Spoken plan summary: when dinner is, when to start, and anything to know. */
export function planSpeech(plan: Plan, timeZone: string, now: number): string {
  const names = plan.dishes.map((d) => d.name.toLowerCase());
  const first = plan.steps.find((s) => s.status !== "done");
  const parts: string[] = [];
  parts.push(`Dinner is ${tomorrow(plan.serveAt, now, timeZone)}at ${clock(plan, 0, timeZone)}: ${listJoin(names)}.`);
  if (first) {
    const startAt = plan.serveAt + first.start * 60000;
    const startsIn = Math.round((startAt - now) / 60000);
    const when = startsIn <= 1 ? "Start now" : `Start ${tomorrow(startAt, now, timeZone)}at ${clock(plan, first.start, timeZone)}`;
    parts.push(`${when} — ${mid(first.label)}.`);
  }
  parts.push(`It's about ${minutes(plan.activeMinutes)} of hands-on work.`);
  const notes = plan.warnings.filter((w) => !w.startsWith("Some steps start earlier"));
  if (notes.length) parts.push(notes.slice(0, 2).join(" "));
  parts.push(`Say "what's next" any time and I'll walk you through it.`);
  return parts.join(" ");
}

function timerLine(s: PlannedStep & { remaining: number }): string {
  const what = s.dishName.toLowerCase();
  if (s.system) return `The oven is heating, ready in ${minutes(s.remaining)}.`;
  if (s.resource.type === "oven") return `The ${what} comes out of the oven in ${minutes(s.remaining)}.`;
  return `${s.dishName}: ${mid(s.label)}, ${minutes(s.remaining)} left.`;
}

/** Spoken "what now": the thing to do, what's next, and running timers. */
export function nowSpeech(plan: Plan, view: NowView, timeZone: string): string {
  if (view.finished) return `Everything should be ready. Enjoy your dinner!`;
  const parts: string[] = [];
  const doNow = [...view.overdue, ...view.current.filter((s) => s.kind === "active")];
  if (doNow.length) {
    parts.push(`Right now: ${listJoin(doNow.map((s) => mid(s.label)))}.`);
  }
  const next = view.upcoming[0];
  if (next) {
    const lead = doNow.length ? "Next" : "Nothing to do right now. Next";
    const when = next.startsIn <= 1 ? "in a minute" : `at ${clock(plan, next.start, timeZone)}, in ${minutes(next.startsIn)}`;
    parts.push(`${lead}, ${when}: ${mid(next.label)}.`);
  }
  const timers = view.current.filter((s) => s.kind === "passive" && s.remaining > 0).slice(0, 2);
  for (const t of timers) parts.push(timerLine(t));
  if (view.minutesToServe > 0) parts.push(`Dinner in ${minutes(view.minutesToServe)}.`);
  return parts.join(" ");
}
