import {
  DEFAULT_KITCHEN,
  type Kitchen,
  type NowView,
  type Plan,
  type PlannedDish,
  type PlannedStep,
  type Recipe,
  type RecipeStep,
  type Resource,
} from "./types.ts";

/** How far (minutes) a flexible prep step may move away from the step after it. */
const MAX_PREP_WAIT = 120;
/** How far (minutes) a whole dish may be pulled earlier than the serve time. */
const MAX_DISH_SHIFT = 240;
/** Oven dishes within this many degrees may be cooked together at a shared temperature. */
const MAX_SHARED_OVEN_DELTA_C = 30;

interface Interval {
  start: number;
  end: number;
}
interface OvenUse extends Interval {
  temp: number;
}

interface Placement {
  start: number;
  end: number;
  oven?: number;
  tempC?: number;
  minutes: number;
}

export interface PlanOptions {
  kitchen?: Partial<Kitchen>;
  /** Earliest allowed start, in minutes relative to serve time (e.g. -45 = not before 45 min before serving). */
  notBefore?: number;
  id?: string;
  now?: number;
  /** Dish ids to use, by recipe index (keeps ids stable across re-plans). */
  dishIds?: string[];
  /** Steps that can't move (already cooking). Times are relative to the serve time. */
  fixed?: PlannedStep[];
  /** Units for temperatures written into step labels and warnings. */
  units?: TempUnits;
}

/** Tracks what is busy at every minute of the plan. Minutes are relative to serve time. */
class KitchenTimeline {
  readonly hands: Interval[] = [];
  readonly burners: Interval[] = [];
  readonly ovens: OvenUse[][];
  readonly kitchen: Kitchen;

  constructor(kitchen: Kitchen) {
    this.kitchen = kitchen;
    this.ovens = Array.from({ length: Math.max(0, kitchen.ovens) }, () => []);
  }

  private static load(list: Interval[], t: number): number {
    let n = 0;
    for (const iv of list) if (iv.start <= t && t < iv.end) n++;
    return n;
  }

  private static fits(list: Interval[], start: number, end: number, capacity: number): boolean {
    for (let t = start; t < end; t++) if (KitchenTimeline.load(list, t) >= capacity) return false;
    return true;
  }

  handsFree(start: number, end: number): boolean {
    return KitchenTimeline.fits(this.hands, start, end, this.kitchen.cooks);
  }

  burnerFree(start: number, end: number): boolean {
    return KitchenTimeline.fits(this.burners, start, end, this.kitchen.burners);
  }

  /** Returns the index of an oven that can take a dish at `temp` for [start, end), or -1. */
  ovenFor(temp: number, start: number, end: number): number {
    const { racksPerOven, ovenToleranceC, preheatMinutes } = this.kitchen;
    for (let k = 0; k < this.ovens.length; k++) {
      const uses = this.ovens[k];
      let ok = true;
      for (const u of uses) {
        const compatible = Math.abs(u.temp - temp) <= ovenToleranceC;
        // An oven needs time to change temperature between incompatible dishes.
        if (!compatible && u.start < end + preheatMinutes && start < u.end + preheatMinutes) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (!KitchenTimeline.fits(uses, start, end, racksPerOven)) continue;
      return k;
    }
    return -1;
  }

  /** Temperatures already in use by oven dishes that overlap the window. */
  ovenTempsNear(start: number, end: number): number[] {
    const temps = new Set<number>();
    for (const uses of this.ovens)
      for (const u of uses) if (u.start < end && start < u.end) temps.add(u.temp);
    return [...temps];
  }

  commit(step: RecipeStep, p: Placement): void {
    if (step.kind === "active") this.hands.push({ start: p.start, end: p.end });
    const r = step.resource ?? { type: "none" };
    if (r.type === "burner") this.burners.push({ start: p.start, end: p.end });
    if (r.type === "oven" && p.oven !== undefined)
      this.ovens[p.oven].push({ start: p.start, end: p.end, temp: p.tempC ?? r.tempC });
  }
}

/** Longer at lower temperature, shorter at higher: roughly 1% per degree C. */
export function adjustOvenMinutes(minutes: number, fromC: number, toC: number): number {
  const delta = fromC - toC;
  const factor = delta >= 0 ? 1 + 0.01 * delta : 1 + 0.008 * delta;
  return Math.max(1, Math.round(minutes * factor));
}

function tryPlace(tl: KitchenTimeline, step: RecipeStep, end: number): Placement | null {
  const r: Resource = step.resource ?? { type: "none" };
  const attempt = (minutes: number, tempC?: number): Placement | null => {
    const start = end - minutes;
    if (step.kind === "active" && !tl.handsFree(start, end)) return null;
    if (r.type === "burner" && !tl.burnerFree(start, end)) return null;
    if (r.type === "oven") {
      if (tl.ovens.length === 0) return null;
      const oven = tl.ovenFor(tempC ?? r.tempC, start, end);
      if (oven < 0) return null;
      return { start, end, oven, tempC: tempC ?? r.tempC, minutes };
    }
    return { start, end, minutes };
  };

  const direct = attempt(step.minutes);
  if (direct || r.type !== "oven" || step.exactTemp) return direct;

  // Share the oven: cook at a neighbour's temperature and adjust the time.
  const windowStart = end - Math.ceil(step.minutes * 1.4);
  const candidates = tl
    .ovenTempsNear(windowStart, end)
    .filter((t) => t !== r.tempC && Math.abs(t - r.tempC) <= MAX_SHARED_OVEN_DELTA_C)
    .sort((a, b) => Math.abs(a - r.tempC) - Math.abs(b - r.tempC));
  for (const t of candidates) {
    const p = attempt(adjustOvenMinutes(step.minutes, r.tempC, t), t);
    if (p) return p;
  }
  return null;
}

/** Places one dish so its last step ends exactly at `lastEnd`, walking backwards. */
function placeDish(
  tl: KitchenTimeline,
  recipe: Recipe,
  lastEnd: number,
  notBefore: number,
): Placement[] | null {
  const placed: Placement[] = [];
  const chain = recipe.steps.reduce((s, x) => s + x.minutes, 0);
  if (lastEnd - chain < notBefore) return null;
  let nextStart = lastEnd;
  for (let j = recipe.steps.length - 1; j >= 0; j--) {
    const step = recipe.steps[j];
    const exact = j === recipe.steps.length - 1 || !step.canWaitAfter;
    const maxWait = exact ? 0 : MAX_PREP_WAIT;
    let found: Placement | null = null;
    for (let end = nextStart; end >= nextStart - maxWait; end--) {
      if (end - step.minutes < notBefore) break;
      found = tryPlace(tl, step, end);
      if (found) break;
    }
    if (!found) return null;
    placed.unshift(found);
    nextStart = found.start;
  }
  return placed;
}

let planCounter = 0;
function newId(): string {
  planCounter = (planCounter + 1) % 1e6;
  return `plan_${Date.now().toString(36)}${planCounter.toString(36)}`;
}

export type TempUnits = "C" | "F";

/** Oven-dial friendly: Celsius as-is, Fahrenheit rounded to the nearest 25°. */
export function formatTemp(c: number, units: TempUnits = "C"): string {
  if (units === "C") return `${c}°C`;
  return `${Math.round(((c * 9) / 5 + 32) / 25) * 25}°F`;
}

/**
 * Schedules several recipes so that they all finish at the serve time, respecting
 * one pair of hands per cook, burner count, oven count, rack space and oven temperature.
 * Dishes that can't wait (fish, pasta) get the slot closest to serving.
 */
export function planMeal(recipes: Recipe[], serveAt: number, options: PlanOptions = {}): Plan {
  const kitchen: Kitchen = { ...DEFAULT_KITCHEN, ...(options.kitchen ?? {}) };
  const units = options.units ?? "C";
  const fmtTemp = (c: number) => formatTemp(c, units);
  const notBefore = options.notBefore ?? -Infinity;
  const tl = new KitchenTimeline(kitchen);
  const warnings: string[] = [];

  const order = recipes
    .map((r, i) => ({ r, i, total: r.steps.reduce((s, x) => s + x.minutes, 0) }))
    .sort((a, b) => a.r.holdMinutes - b.r.holdMinutes || b.total - a.total);

  const dishes: PlannedDish[] = [];
  const steps: PlannedStep[] = [];

  for (const f of options.fixed ?? []) {
    tl.commit(
      { label: f.label, minutes: f.end - f.start, kind: f.kind, resource: f.resource },
      { start: f.start, end: f.end, oven: f.oven, tempC: f.resource.type === "oven" ? f.resource.tempC : undefined, minutes: f.end - f.start },
    );
    steps.push({ ...f });
  }
  const fixedDishes = new Map<string, number>();
  for (const f of options.fixed ?? []) fixedDishes.set(f.dishId, Math.max(fixedDishes.get(f.dishId) ?? -Infinity, f.end));

  for (const { r, i } of order) {
    const dishId = options.dishIds?.[i] ?? `d${i + 1}`;
    if (r.steps.some((s) => s.resource?.type === "oven") && kitchen.ovens === 0) {
      warnings.push(`${r.name} needs an oven, and this kitchen has none, so I left it out.`);
      continue;
    }
    let placement: Placement[] | null = null;
    let lastEnd = 0;
    const chain = r.steps.reduce((s, x) => s + x.minutes, 0);
    for (; lastEnd >= -MAX_DISH_SHIFT; lastEnd--) {
      if (lastEnd - chain < notBefore) break; // pulling earlier can't help
      placement = placeDish(tl, r, lastEnd, notBefore);
      if (placement) break;
    }
    if (!placement) {
      warnings.push(`I couldn't fit ${r.name} into the time you have. Try a later serve time or drop a dish.`);
      continue;
    }
    placement.forEach((p, j) => {
      const src = r.steps[j];
      tl.commit(src, p);
      const resource: Resource =
        src.resource?.type === "oven" ? { type: "oven", tempC: p.tempC ?? src.resource.tempC } : src.resource ?? { type: "none" };
      let label = src.label;
      if (src.resource?.type === "oven" && p.tempC !== undefined && p.tempC !== src.resource.tempC) {
        label = `${src.label} at ${fmtTemp(p.tempC)} for ${p.minutes} min so it can share the oven`;
        warnings.push(
          `To share the oven, ${r.name} cooks at ${fmtTemp(p.tempC)} for ${p.minutes} minutes instead of ${fmtTemp(src.resource.tempC)} for ${src.minutes}.`,
        );
      }
      steps.push({
        id: src.id ?? `${dishId}s${j + 1}`,
        dishId,
        dishName: r.name,
        label,
        kind: src.kind,
        resource,
        oven: p.oven,
        start: p.start,
        end: p.end,
        status: "pending",
      });
    });
    const waits = -lastEnd + 0;
    dishes.push({ id: dishId, name: r.name, readyAt: lastEnd, holdMinutes: r.holdMinutes, waits });
    if (waits > r.holdMinutes) {
      warnings.push(
        `${r.name} will be ready ${waits} minutes before serving. It holds well for about ${r.holdMinutes}, so keep it covered and warm.`,
      );
    }
  }

  for (const [id, end] of fixedDishes) {
    const f = (options.fixed ?? []).find((x) => x.dishId === id)!;
    dishes.push({ id, name: f.dishName, readyAt: end, holdMinutes: 10, waits: -end });
  }
  const preheats = preheatSteps(tl, kitchen, steps, units).filter((p) => p.start >= (Number.isFinite(notBefore) ? notBefore : -Infinity));
  steps.push(...preheats);
  steps.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  dishes.sort((a, b) => a.readyAt - b.readyAt);

  const startMin = steps.length ? Math.min(...steps.map((s) => s.start)) : 0;
  const activeMinutes = steps.filter((s) => s.kind === "active").reduce((s, x) => s + (x.end - x.start), 0);
  const totalMinutes = -startMin;
  if (totalMinutes > 0 && kitchen.cooks === 1 && activeMinutes / totalMinutes > 0.75) {
    warnings.push("This menu keeps your hands busy almost the whole time. A helper would make it relaxed.");
  }
  const fixedIds = new Set((options.fixed ?? []).map((f) => f.id));
  const earliestPlanned = Math.min(0, ...steps.filter((s) => !fixedIds.has(s.id)).map((s) => s.start));
  if (Number.isFinite(notBefore) && earliestPlanned < notBefore) {
    warnings.push("Some steps start earlier than you asked; consider a later serve time.");
  }

  return {
    id: options.id ?? newId(),
    serveAt,
    createdAt: options.now ?? Date.now(),
    units,
    kitchen,
    dishes,
    steps,
    warnings,
    activeMinutes,
    totalMinutes,
  };
}

/** One preheat (or temperature change) before each continuous stretch of oven use. */
function preheatSteps(tl: KitchenTimeline, kitchen: Kitchen, planned: PlannedStep[], units: TempUnits): PlannedStep[] {
  const fmtTemp = (c: number) => formatTemp(c, units);
  const out: PlannedStep[] = [];
  tl.ovens.forEach((uses, k) => {
    const sorted = [...uses].sort((a, b) => a.start - b.start);
    const segments: OvenUse[] = [];
    for (const u of sorted) {
      const last = segments[segments.length - 1];
      if (last && Math.abs(last.temp - u.temp) <= kitchen.ovenToleranceC && u.start <= last.end + 30) {
        last.end = Math.max(last.end, u.end);
        last.temp = Math.max(last.temp, u.temp);
      } else segments.push({ ...u });
    }
    segments.forEach((seg, n) => {
      const prev = segments[n - 1];
      const change = prev && seg.start - prev.end <= kitchen.preheatMinutes + 30;
      const ovenName = tl.ovens.length > 1 ? `oven ${k + 1}` : "the oven";
      out.push({
        id: `o${k + 1}p${n + 1}`,
        dishId: "oven",
        dishName: tl.ovens.length > 1 ? `Oven ${k + 1}` : "Oven",
        label: change ? `Set ${ovenName} to ${fmtTemp(seg.temp)}` : `Preheat ${ovenName} to ${fmtTemp(seg.temp)}`,
        kind: "passive",
        resource: { type: "oven", tempC: seg.temp },
        oven: k,
        start: seg.start - kitchen.preheatMinutes,
        end: seg.start,
        status: "pending",
        system: true,
      });
    });
  });
  // Keep ids unique even if a recipe step happened to share one.
  const taken = new Set(planned.map((s) => s.id));
  return out.filter((s) => !taken.has(s.id));
}

/** Minutes relative to serve time for an absolute timestamp. */
export function offsetOf(plan: Plan, at: number): number {
  return (at - plan.serveAt) / 60000;
}

export function stepTime(plan: Plan, minuteOffset: number): number {
  return plan.serveAt + minuteOffset * 60000;
}

/**
 * Minutes after its planned end that an unconfirmed hands-on step still shows as
 * "catch up". After that it's assumed done: people cooking by voice rarely confirm every step.
 */
export const CATCH_UP_GRACE = 5;

/** What should be happening at `now` (epoch ms). */
export function nowView(plan: Plan, now: number, upcomingCount = 3): NowView {
  const t = offsetOf(plan, now);
  const current: NowView["current"] = [];
  const upcoming: NowView["upcoming"] = [];
  const overdue: PlannedStep[] = [];
  for (const s of plan.steps) {
    if (s.status === "done") continue;
    if (s.start <= t && t < s.end) current.push({ ...s, remaining: Math.max(0, Math.ceil(s.end - t)) });
    else if (s.start > t) upcoming.push({ ...s, startsIn: Math.max(0, Math.ceil(s.start - t)) });
    else if (s.kind === "active" && s.end <= t && t < s.end + CATCH_UP_GRACE) overdue.push(s);
  }
  upcoming.sort((a, b) => a.start - b.start);
  return {
    current,
    upcoming: upcoming.slice(0, upcomingCount),
    overdue,
    minutesToServe: Math.ceil(-t),
    finished: t >= 0,
  };
}

/** Marks a step done. Returns false when the id doesn't exist. */
export function markDone(plan: Plan, stepId: string): boolean {
  const s = plan.steps.find((x) => x.id === stepId);
  if (!s) return false;
  s.status = "done";
  return true;
}

/** Finds the pending step a person most likely means ("the rice", "salmon is in"). */
export function matchStep(plan: Plan, phrase: string, now?: number): PlannedStep | undefined {
  const words = phrase
    .toLowerCase()
    .replace(/[^a-z0-9ćčđšž\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const t = now === undefined ? undefined : offsetOf(plan, now);
  let best: { s: PlannedStep; score: number } | undefined;
  for (const s of plan.steps) {
    if (s.status === "done") continue;
    const hay = `${s.dishName} ${s.label}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += w.length;
    if (score === 0) continue;
    if (t !== undefined) score -= Math.min(10, Math.abs(s.start - t) / 10);
    if (!best || score > best.score) best = { s, score };
  }
  return best?.s;
}
const STOP = new Set(["the", "and", "done", "with", "finished", "put", "now", "just", "have", "has", "its", "it's", "into", "for"]);

/**
 * Pushes dinner back by `minutes`: steps that haven't started move with it, while
 * finished steps and anything already cooking stay where they are in real time.
 */
export function delayPlan(plan: Plan, minutes: number, now: number): Plan {
  const t = offsetOf(plan, now);
  const steps = plan.steps.map((s) => {
    const started = s.status === "done" || s.start <= t;
    return started ? { ...s, start: s.start - minutes, end: s.end - minutes } : { ...s };
  });
  const next: Plan = { ...plan, serveAt: plan.serveAt + minutes * 60000, steps, warnings: [...plan.warnings] };
  next.dishes = plan.dishes.map((d) => {
    const last = steps.filter((s) => s.dishId === d.id).reduce((m, s) => Math.max(m, s.end), -Infinity);
    const readyAt = Number.isFinite(last) ? last : d.readyAt;
    return { ...d, readyAt, waits: -readyAt };
  });
  for (const d of next.dishes) {
    if (d.waits > d.holdMinutes && !plan.dishes.find((o) => o.id === d.id && o.waits > o.holdMinutes)) {
      next.warnings.push(`${d.name} is already cooking, so it will be ready ${d.waits} minutes early. Keep it warm.`);
    }
  }
  return next;
}

/**
 * Re-plans from `now`. Steps that should have started more than `lateBy` minutes ago are
 * assumed handled (a voice cook rarely confirms every step); anything cooking stays fixed
 * in real time, and everything else is rescheduled. Keeps the serve time when possible,
 * otherwise moves it to the earliest time that works.
 */
export function replanFromNow(plan: Plan, now: number, lateBy = 0): { plan: Plan; movedBy: number } {
  const t = Math.ceil(offsetOf(plan, now));
  const eff = t - Math.max(0, lateBy);
  const handled = (s: PlannedStep) => s.status === "done" || s.start < eff;
  const running = new Set(
    plan.steps
      .filter((s) => !s.system && s.status !== "done" && s.kind === "passive" && s.start < eff && t < s.end)
      .map((s) => s.dishId),
  );
  const pinned = plan.steps.filter(
    (s) =>
      (running.has(s.dishId) && s.status !== "done" && s.end > t) ||
      (s.system && s.status !== "done" && s.start < eff && t < s.end),
  );
  const pinnedIds = new Set(pinned.map((s) => s.id));
  const remaining = remainingRecipes(plan, eff).filter((r) => !running.has(r.id));
  if (remaining.length === 0) return { plan, movedBy: 0 };

  const dishIds = remaining.map((r) => r.id);
  for (let movedBy = 0; movedBy <= 180; movedBy += movedBy < 30 ? 1 : 5) {
    const serveAt = plan.serveAt + movedBy * 60000;
    const notBefore = t - movedBy;
    const fixed = pinned.map((s) => ({ ...s, start: s.start - movedBy, end: s.end - movedBy }));
    const next = planMeal(remaining, serveAt, { kitchen: plan.kitchen, notBefore, id: plan.id, now, dishIds, fixed, units: plan.units });
    const fits =
      next.steps.every((s) => pinnedIds.has(s.id) || s.start >= notBefore) &&
      !next.warnings.some((w) => w.startsWith("I couldn't fit"));
    if (fits) {
      const done = plan.steps
        .filter((s) => handled(s) && !pinnedIds.has(s.id))
        .map((s) => ({ ...s, status: "done" as const, start: s.start - movedBy, end: s.end - movedBy }));
      next.steps = [...done, ...next.steps].sort((a, b) => a.start - b.start || a.end - b.end);
      const kept = plan.dishes
        .filter((d) => !next.dishes.some((n) => n.id === d.id))
        .map((d) => ({ ...d, readyAt: d.readyAt - movedBy, waits: d.waits + movedBy }));
      next.dishes = [...kept, ...next.dishes]
        .map((d) => ({ ...d, holdMinutes: plan.dishes.find((o) => o.id === d.id)?.holdMinutes ?? d.holdMinutes }))
        .sort((a, b) => a.readyAt - b.readyAt);
      next.createdAt = plan.createdAt;
      return { plan: next, movedBy };
    }
  }
  return { plan, movedBy: -1 };
}

/** Turns the unfinished part of a plan back into recipes. */
function remainingRecipes(plan: Plan, t: number): Recipe[] {
  const byDish = new Map<string, PlannedStep[]>();
  for (const s of plan.steps) {
    if (s.system || s.status === "done") continue;
    if (s.start < t) continue;
    const list = byDish.get(s.dishId) ?? [];
    list.push(s);
    byDish.set(s.dishId, list);
  }
  const out: Recipe[] = [];
  for (const [dishId, list] of byDish) {
    list.sort((a, b) => a.start - b.start);
    const dish = plan.dishes.find((d) => d.id === dishId);
    out.push({
      id: dishId,
      name: list[0].dishName,
      holdMinutes: dish?.holdMinutes ?? 10,
      steps: list.map((s, i) => {
        const next = list[i + 1];
        return {
          id: s.id,
          label: s.label,
          minutes: s.end - s.start,
          kind: s.kind,
          resource: s.resource,
          canWaitAfter: next ? next.start > s.end : false,
        };
      }),
    });
  }
  return out;
}

/** Plain-language timing for a step, e.g. "6:40 PM". */
export function clock(plan: Plan, minuteOffset: number, timeZone?: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(stepTime(plan, minuteOffset)),
  );
}
