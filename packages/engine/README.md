# sous-engine

Plan a multi-dish meal so **every dish is ready at the same time**, around a real kitchen: one pair of hands per cook, a limited number of burners, oven rack space and oven temperature.

It's the scheduling core of [Sous](https://github.com/stefansavic7/sous), an Alexa+ cooking skill, released on its own so anyone building a cooking assistant, a smart-oven app or a meal-kit product can use it. No dependencies, works in Node and in the browser.

```ts
import { planMeal, resolveDish, nowView } from "sous-engine";

const dinner = planMeal(
  [resolveDish("salmon")!, resolveDish("rice")!, resolveDish("broccoli")!],
  Date.parse("2026-10-01T19:00:00-04:00"),
  { units: "F" },
);

for (const step of dinner.steps) console.log(step.start, step.dishName, step.label);
// -36 Oven                 Preheat the oven to 400°F
// -34 Fluffy white rice    Rinse the rice until the water runs clear
// -31 Fluffy white rice    Bring the rice and water to a boil
// -30 Roasted broccoli     Cut the broccoli into florets and toss with oil and salt
// -25 Fluffy white rice    Cover the rice and simmer on low
// -24 Roasted broccoli     Put the broccoli in the oven to roast at 400°F for 24 min so it can share the oven
// -22 Lemon garlic salmon  Mix lemon, garlic and olive oil, then season the salmon
// -17 Lemon garlic salmon  Put the salmon in the oven
// -10 Fluffy white rice    Take the rice off the heat and let it steam, lid on
//  -3 Lemon garlic salmon  Let the salmon rest
```

Times are minutes relative to serving (`-36` = 36 minutes before dinner).

## What it takes into account

- **Hands.** Active steps (chopping, searing, mashing) need a cook; passive steps (baking, simmering, resting) don't. Set `cooks` for more help.
- **Burners** and **ovens**, including how many dishes fit in one oven (`racksPerOven`).
- **Oven temperature.** Dishes within 15°C share an oven as-is. Within 30°C, one dish is cooked at the other's temperature with the time adjusted about 1% per degree, and the plan says so. Steps marked `exactTemp` (baking) are never adjusted.
- **Preheating and temperature changes** are inserted automatically.
- **Holding.** Each recipe says how long it can wait once done (`holdMinutes`). Dishes that can't wait (fish, pasta) finish last; the plan warns when something will wait longer than it holds well.

## API

| Function | Does |
| --- | --- |
| `planMeal(recipes, serveAt, options?)` | Builds a `Plan`: scheduled steps, dish ready times, warnings, hands-on minutes. |
| `nowView(plan, now)` | What to do now, what's next, running timers, minutes to dinner. Unconfirmed hands-on steps show as "catch up" for 5 minutes. |
| `markDone(plan, stepId)` / `matchStep(plan, phrase)` | Record progress; find the step someone means ("the rice is rinsed"). |
| `replanFromNow(plan, now, lateBy?)` | Re-plan after falling behind: keeps what's cooking, reschedules the rest, keeps dinner time when possible. |
| `delayPlan(plan, minutes, now)` | Push dinner back, leaving finished and cooking steps in place. |
| `parseRecipe(text, name?)` | Turns recipe text into steps: durations ("10-12 min", "1 1/2 hours"), oven temperatures (°F, °C, gas mark), active vs passive, burner vs oven. |
| `parseServeTime(text, now, timeZone)` | "7pm", "19:30", "7:30", "in 90 minutes", ISO; time-zone aware. |
| `LIBRARY`, `findRecipes`, `resolveDish` | A small built-in cookbook and fuzzy dish lookup. |

Options for `planMeal`: `kitchen` (`ovens`, `racksPerOven`, `burners`, `cooks`, `preheatMinutes`, `ovenToleranceC`), `units` (`"C"` or `"F"`), `notBefore`, `fixed` (steps already cooking).

## Recipe format

```ts
const pasta: Recipe = {
  id: "spaghetti-aglio-olio",
  name: "Spaghetti aglio e olio",
  holdMinutes: 2,
  steps: [
    { label: "Bring a big pot of salted water to a boil", minutes: 10, kind: "passive", resource: { type: "burner" } },
    { label: "Cook the spaghetti", minutes: 9, kind: "passive", resource: { type: "burner" } },
    { label: "Toss with garlic oil, chili and parsley", minutes: 3, kind: "active", resource: { type: "burner" } },
  ],
};
```

`canWaitAfter: true` on a step lets the food sit before the next step (chopped vegetables can wait; a seared steak goes straight to resting).

## How the planner works

Dishes are ordered by how long they can wait once finished. Each is placed backwards from the serve time, step by step, at the latest minute where its needs are free: a cook for active steps, a burner, or an oven rack at a compatible temperature (with time to change the oven's temperature between incompatible dishes). Prep steps may move earlier; cooking steps stay back to back. If a dish can't fit, it's pulled earlier and flagged if that's longer than it holds well. It's a greedy list scheduler, fast enough to re-plan on every voice command.

## Develop

```bash
npm test        # node --test (Node 22.18+ runs the TypeScript directly)
npm run build   # compiles to dist/
```

MIT License.
