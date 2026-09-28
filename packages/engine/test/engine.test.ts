import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_KITCHEN,
  LIBRARY,
  delayPlan,
  findRecipes,
  markDone,
  matchStep,
  nowView,
  parseDuration,
  parseRecipe,
  parseServeTime,
  parseTemperature,
  planMeal,
  replanFromNow,
  resolveDish,
  type Plan,
  type PlannedStep,
  type Recipe,
} from "../src/index.ts";

const SERVE = Date.UTC(2026, 9, 1, 17, 0);
const get = (n: string): Recipe => {
  const r = resolveDish(n);
  assert.ok(r, `no recipe for ${n}`);
  return r;
};

function maxOverlap(steps: PlannedStep[], pred: (s: PlannedStep) => boolean): number {
  const sel = steps.filter(pred);
  if (!sel.length) return 0;
  const lo = Math.min(...sel.map((s) => s.start));
  let max = 0;
  for (let t = lo; t < 0; t++) max = Math.max(max, sel.filter((s) => s.start <= t && t < s.end).length);
  return max;
}

function assertPhysicallyValid(plan: Plan) {
  const k = plan.kitchen;
  assert.ok(maxOverlap(plan.steps, (s) => s.kind === "active") <= k.cooks, "more active steps than cooks");
  assert.ok(maxOverlap(plan.steps, (s) => s.resource.type === "burner") <= k.burners, "more pots than burners");
  for (let o = 0; o < k.ovens; o++) {
    const inOven = plan.steps.filter((s) => s.oven === o && !s.system);
    assert.ok(maxOverlap(inOven, () => true) <= k.racksPerOven, "oven over capacity");
    for (const a of inOven)
      for (const b of inOven) {
        if (a === b || a.resource.type !== "oven" || b.resource.type !== "oven") continue;
        if (Math.abs(a.resource.tempC - b.resource.tempC) > k.ovenToleranceC) {
          const gapOk = a.end + k.preheatMinutes <= b.start || b.end + k.preheatMinutes <= a.start;
          assert.ok(gapOk, `${a.label} and ${b.label} share an oven at different temperatures`);
        }
      }
  }
  // Steps of the same dish never overlap and keep their order.
  const byDish = new Map<string, PlannedStep[]>();
  for (const s of plan.steps) if (!s.system) byDish.set(s.dishId, [...(byDish.get(s.dishId) ?? []), s]);
  for (const list of byDish.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end, "dish steps overlap");
  }
}

test("a dish with nothing in its way finishes exactly at serve time", () => {
  const plan = planMeal([get("rice")], SERVE);
  const last = plan.steps.filter((s) => !s.system).at(-1)!;
  assert.equal(last.end, 0);
  assert.equal(plan.dishes[0].waits, 0);
  assert.equal(plan.warnings.length, 0);
});

test("salmon, rice and broccoli: valid plan, least-holdable dish finishes last", () => {
  const plan = planMeal([get("salmon"), get("rice"), get("broccoli")], SERVE);
  assertPhysicallyValid(plan);
  const salmon = plan.dishes.find((d) => d.name.includes("salmon"))!;
  assert.equal(salmon.readyAt, 0);
  assert.ok(plan.steps.some((s) => s.system && /Preheat/.test(s.label)), "preheat step added");
  const preheat = plan.steps.find((s) => s.system)!;
  const firstOven = plan.steps.filter((s) => !s.system && s.resource.type === "oven").sort((a, b) => a.start - b.start)[0];
  assert.equal(preheat.end, firstOven.start, "oven is hot when the first dish goes in");
});

test("close oven temperatures are merged and the time is adjusted", () => {
  const plan = planMeal([get("salmon"), get("broccoli")], SERVE);
  const broccoli = plan.steps.find((s) => s.dishName === "Roasted broccoli" && s.resource.type === "oven")!;
  assert.equal(broccoli.resource.type === "oven" && broccoli.resource.tempC, 200);
  assert.equal(broccoli.end - broccoli.start, 24);
  assert.ok(plan.warnings.some((w) => w.includes("share the oven")));
});

test("baking keeps its exact temperature", () => {
  const plan = planMeal([get("brownies"), get("salmon"), get("roast potatoes")], SERVE);
  assertPhysicallyValid(plan);
  const bake = plan.steps.find((s) => s.dishName === "Chocolate brownies" && s.resource.type === "oven")!;
  assert.equal(bake.resource.type === "oven" && bake.resource.tempC, 180);
  assert.equal(bake.end - bake.start, 25);
  assert.ok(plan.steps.some((s) => s.system && /Set the oven/.test(s.label)), "temperature change step");
});

test("big menu respects hands, burners, racks and temperatures", () => {
  const names = ["salmon", "roast potatoes", "broccoli", "garlic bread", "green beans", "brownies", "rice"];
  const plan = planMeal(names.map(get), SERVE);
  assertPhysicallyValid(plan);
  assert.equal(plan.dishes.length, names.length);
});

test("two cooks and two ovens make the plan shorter", () => {
  const menu = ["salmon", "roast potatoes", "brownies", "garlic bread", "mashed potatoes"].map(get);
  const solo = planMeal(menu, SERVE);
  const team = planMeal(menu, SERVE, { kitchen: { cooks: 2, ovens: 2 } });
  assertPhysicallyValid(team);
  assert.ok(team.totalMinutes <= solo.totalMinutes);
});

test("one burner forces stovetop dishes to take turns", () => {
  const plan = planMeal([get("rice"), get("green beans"), get("spaghetti")], SERVE, { kitchen: { burners: 1 } });
  assertPhysicallyValid(plan);
  assert.equal(maxOverlap(plan.steps, (s) => s.resource.type === "burner"), 1);
});

test("a kitchen without an oven skips oven dishes with a warning", () => {
  const plan = planMeal([get("salmon"), get("rice")], SERVE, { kitchen: { ovens: 0 } });
  assert.equal(plan.dishes.length, 1);
  assert.ok(plan.warnings.some((w) => w.includes("needs an oven")));
});

test("nowView reports current, upcoming and overdue steps", () => {
  const plan = planMeal([get("salmon"), get("rice"), get("broccoli")], SERVE);
  const first = plan.steps.filter((s) => s.kind === "active")[0];
  const v = nowView(plan, SERVE + (first.end + 1) * 60000);
  assert.ok(v.overdue.some((s) => s.id === first.id));
  markDone(plan, first.id);
  const v2 = nowView(plan, SERVE + (first.end + 1) * 60000);
  assert.ok(!v2.overdue.some((s) => s.id === first.id));
  assert.ok(v2.upcoming.every((s, i, a) => i === 0 || a[i - 1].start <= s.start));
  const end = nowView(plan, SERVE + 60000);
  assert.equal(end.minutesToServe, -1);
});

test("unconfirmed hands-on steps stop nagging after a grace period", () => {
  const plan = planMeal([get("salmon"), get("rice"), get("broccoli")], SERVE);
  const first = plan.steps.filter((s) => s.kind === "active")[0];
  const soon = nowView(plan, SERVE + (first.end + 1) * 60000);
  assert.ok(soon.overdue.some((s) => s.id === first.id));
  const later = nowView(plan, SERVE + (first.end + 6) * 60000);
  assert.ok(!later.overdue.some((s) => s.id === first.id));
});

test("matchStep understands loose phrases", () => {
  const plan = planMeal([get("salmon"), get("rice"), get("broccoli")], SERVE);
  assert.equal(matchStep(plan, "I rinsed the rice")?.dishName, "Fluffy white rice");
  assert.equal(matchStep(plan, "salmon is seasoned")?.dishName, "Lemon garlic salmon");
  assert.equal(matchStep(plan, "xyz"), undefined);
});

test("running late re-plans the steps that were just missed", () => {
  const plan = planMeal([get("salmon"), get("rice"), get("broccoli")], SERVE);
  const now = SERVE - 20 * 60000;
  const { plan: next, movedBy } = replanFromNow(plan, now, 10);
  assert.ok(movedBy >= 0);
  const missed = plan.steps.filter((s) => !s.system && s.start >= -30 && s.start < -20);
  for (const m of missed) {
    const moved = next.steps.find((s) => s.id === m.id)!;
    assert.ok(moved.start >= -20 - movedBy, `${m.label} should be rescheduled from now`);
  }
  assertPhysicallyValid(next);
});

test("replanning keeps the serve time when the cook is on schedule", () => {
  const plan = planMeal([get("salmon"), get("rice")], SERVE);
  const first = plan.steps[0];
  const { plan: next, movedBy } = replanFromNow(plan, SERVE + first.start * 60000);
  assert.equal(movedBy, 0);
  assert.equal(next.serveAt, SERVE);
  assertPhysicallyValid(next);
});

test("replanning pushes serving back when there isn't enough time left", () => {
  const plan = planMeal([get("roast potatoes"), get("salmon")], SERVE);
  const now = SERVE - 20 * 60000; // nothing done yet, only 20 minutes left
  const { plan: next, movedBy } = replanFromNow(plan, now, 120);
  assert.ok(movedBy > 0);
  assert.equal(next.serveAt, SERVE + movedBy * 60000);
  assert.ok(next.steps.filter((s) => !s.system && s.status !== "done").every((s) => s.start >= -20 - movedBy));
  assertPhysicallyValid(next);
});

test("replanning never moves a dish that's already in the oven", () => {
  const plan = planMeal([get("salmon"), get("rice"), get("broccoli")], SERVE);
  const bake = plan.steps.find((s) => s.dishName === "Roasted broccoli" && s.resource.type === "oven")!;
  const now = SERVE + (bake.start + 2) * 60000;
  for (const s of plan.steps) if (s.end <= bake.start + 2 && s.kind === "active") markDone(plan, s.id);
  const { plan: next, movedBy } = replanFromNow(plan, now);
  const moved = next.steps.find((s) => s.id === bake.id)!;
  assert.equal(moved.start + movedBy, bake.start);
  assert.equal(moved.end + movedBy, bake.end);
});

test("delayPlan moves pending steps and leaves finished ones in place", () => {
  const plan = planMeal([get("salmon"), get("rice")], SERVE);
  const first = plan.steps.find((s) => s.kind === "active")!;
  markDone(plan, first.id);
  const now = SERVE + (first.end) * 60000;
  const later = delayPlan(plan, 10, now);
  assert.equal(later.serveAt, SERVE + 600000);
  const done = later.steps.find((s) => s.id === first.id)!;
  assert.equal(done.start, first.start - 10);
  const pending = later.steps.find((s) => s.status === "pending" && !s.system && s.start > first.end)!;
  const orig = plan.steps.find((s) => s.id === pending.id)!;
  assert.equal(pending.start, orig.start);
});

test("parseDuration handles ranges, hours, fractions and words", () => {
  assert.equal(parseDuration("Bake for 25 minutes"), 25);
  assert.equal(parseDuration("simmer 10-12 min"), 12);
  assert.equal(parseDuration("simmer 10-12 min", "mean"), 11);
  assert.equal(parseDuration("roast for 1 1/2 hours"), 90);
  assert.equal(parseDuration("braise for 2 hours"), 120);
  assert.equal(parseDuration("cook for an hour and 15 minutes"), 75);
  assert.equal(parseDuration("rest for five minutes"), 5);
  assert.equal(parseDuration("half an hour in the fridge"), 30);
  assert.equal(parseDuration("stir well"), null);
});

test("parseTemperature converts to Celsius", () => {
  assert.equal(parseTemperature("Preheat the oven to 400°F"), 205);
  assert.equal(parseTemperature("bake at 180 C"), 180);
  assert.equal(parseTemperature("Heat to 350 degrees"), 175);
  assert.equal(parseTemperature("gas mark 6"), 200);
  assert.equal(parseTemperature("add 2 eggs"), null);
});

test("parseRecipe turns text into schedulable steps", () => {
  const r = parseRecipe(`Sheet-pan chicken
1. Preheat the oven to 425°F.
2. Chop the peppers and onion.
3. Roast chicken and vegetables for 30-35 minutes.
4. Let rest for 5 minutes.
5. Serve.`);
  assert.equal(r.name, "Sheet-pan chicken");
  assert.equal(r.steps.length, 3);
  assert.deepEqual(r.steps.map((s) => s.kind), ["active", "passive", "passive"]);
  assert.deepEqual(r.steps[1].resource, { type: "oven", tempC: 220 });
  assert.equal(r.steps[1].minutes, 35);
  assert.ok(r.steps[0].canWaitAfter);
  const plan = planMeal([r], SERVE);
  assertPhysicallyValid(plan);
});

test("parseServeTime understands everyday phrasing and time zones", () => {
  const noon = Date.UTC(2026, 9, 1, 10, 0); // 12:00 in Sarajevo (UTC+2)
  const tz = "Europe/Sarajevo";
  assert.equal(parseServeTime("7pm", noon, tz), Date.UTC(2026, 9, 1, 17, 0));
  assert.equal(parseServeTime("19:30", noon, tz), Date.UTC(2026, 9, 1, 17, 30));
  assert.equal(parseServeTime("at 7", noon, tz), Date.UTC(2026, 9, 1, 17, 0));
  assert.equal(parseServeTime("7:30", noon, tz), Date.UTC(2026, 9, 1, 17, 30), "no am/pm → next occurrence");
  assert.equal(parseServeTime("11", noon, tz), Date.UTC(2026, 9, 1, 21, 0));
  assert.equal(parseServeTime("in 90 minutes", noon, tz), noon + 90 * 60000);
  assert.equal(parseServeTime("in an hour", noon, tz), noon + 3600000);
  assert.equal(parseServeTime("in 40 minutes", noon + 20000, tz), noon + 41 * 60000, "rounds up to a whole minute");
  assert.equal(parseServeTime("9am", noon, tz), Date.UTC(2026, 9, 2, 7, 0), "past times roll to tomorrow");
  assert.equal(parseServeTime("banana", noon, tz), null);
  assert.equal(parseServeTime("6:30 pm", noon, "America/New_York"), Date.UTC(2026, 9, 1, 22, 30));
});

test("library search finds dishes by name and ingredient", () => {
  assert.equal(resolveDish("salmon")?.id, "lemon-garlic-salmon");
  assert.equal(resolveDish("mashed potatoes")?.id, "mashed-potatoes");
  assert.equal(resolveDish("cevapi")?.id, "cevapi");
  assert.equal(resolveDish("sushi"), undefined);
  assert.ok(findRecipes("potato").length >= 2);
  assert.ok(LIBRARY.every((r) => r.steps.every((s) => s.minutes >= 1)));
  assert.equal(DEFAULT_KITCHEN.cooks, 1);
});
