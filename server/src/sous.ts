import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { CallToolResult, ReadResourceResult, ServerContext } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  delayPlan,
  findRecipes,
  markDone,
  matchStep,
  nowView,
  parseRecipe,
  parseServeTime,
  planMeal,
  replanFromNow,
  resolveDish,
  clock,
  formatTemp,
  type Plan,
  type Recipe,
} from "../../packages/engine/src/index.ts";
import { SousStore } from "./store.ts";
import { listJoin, nowSpeech, planSpeech } from "./speech.ts";

export const TIMELINE_URI = "ui://sous/timeline.html";
export const VERSION = "0.1.0";

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f2a24"/><circle cx="32" cy="34" r="17" fill="none" stroke="#f3c969" stroke-width="4"/><path d="M32 34V23M32 34l8 5" stroke="#f3c969" stroke-width="4" stroke-linecap="round"/><path d="M18 12h28" stroke="#9ad1a8" stroke-width="4" stroke-linecap="round"/></svg>`;
const ICON = {
  src: `data:image/svg+xml;base64,${typeof Buffer !== "undefined" ? Buffer.from(ICON_SVG).toString("base64") : btoa(ICON_SVG)}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
};

// registerAppTool's config type doesn't list `icons` yet, although MCP 2025-11-25 tools support them.
const APP_TOOL_ICONS: Record<string, unknown> = { icons: [ICON] };

export interface SousDeps {
  store: SousStore;
  now?: () => number;
  /** Returns the bundled HTML of the Echo Show timeline view. */
  timelineHtml: () => string | Promise<string>;
}

// ---------- structured output (what the Echo Show view renders) ----------

const StepDTO = z.object({
  id: z.string(),
  dishId: z.string(),
  dish: z.string(),
  label: z.string(),
  kind: z.enum(["active", "passive"]),
  resource: z.enum(["oven", "burner", "none"]),
  temp: z.string().optional(),
  oven: z.number().optional(),
  start: z.number(),
  end: z.number(),
  startAt: z.string(),
  endAt: z.string(),
  status: z.enum(["pending", "done"]),
  system: z.boolean(),
});
const PlanDTO = z.object({
  id: z.string(),
  serveAt: z.string(),
  serveAtMs: z.number(),
  timeZone: z.string(),
  units: z.enum(["C", "F"]),
  kitchen: z.object({ ovens: z.number(), burners: z.number(), cooks: z.number(), racksPerOven: z.number() }),
  dishes: z.array(z.object({ id: z.string(), name: z.string(), readyAt: z.string(), waits: z.number(), holdMinutes: z.number() })),
  steps: z.array(StepDTO),
  warnings: z.array(z.string()),
  activeMinutes: z.number(),
  totalMinutes: z.number(),
});
const NowDTO = z.object({
  at: z.string(),
  atMs: z.number(),
  doNow: z.array(z.string()),
  running: z.array(z.object({ id: z.string(), remaining: z.number() })),
  next: z.array(z.object({ id: z.string(), startsIn: z.number() })),
  minutesToServe: z.number(),
  finished: z.boolean(),
});
const DinnerResult = z.object({
  speech: z.string(),
  plan: PlanDTO.nullable(),
  now: NowDTO.nullable(),
  unknownDishes: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
});
type DinnerResultT = z.infer<typeof DinnerResult>;

function planDTO(plan: Plan, timeZone: string): z.infer<typeof PlanDTO> {
  const iso = (m: number) => new Date(plan.serveAt + m * 60000).toISOString();
  return {
    id: plan.id,
    serveAt: new Date(plan.serveAt).toISOString(),
    serveAtMs: plan.serveAt,
    timeZone,
    units: plan.units,
    kitchen: {
      ovens: plan.kitchen.ovens,
      burners: plan.kitchen.burners,
      cooks: plan.kitchen.cooks,
      racksPerOven: plan.kitchen.racksPerOven,
    },
    dishes: plan.dishes.map((d) => ({ id: d.id, name: d.name, readyAt: iso(d.readyAt), waits: d.waits, holdMinutes: d.holdMinutes })),
    steps: plan.steps.map((s) => ({
      id: s.id,
      dishId: s.dishId,
      dish: s.dishName,
      label: s.label,
      kind: s.kind,
      resource: s.resource.type,
      temp: s.resource.type === "oven" ? formatTemp(s.resource.tempC, plan.units) : undefined,
      oven: s.oven,
      start: s.start,
      end: s.end,
      startAt: iso(s.start),
      endAt: iso(s.end),
      status: s.status,
      system: Boolean(s.system),
    })),
    warnings: plan.warnings,
    activeMinutes: plan.activeMinutes,
    totalMinutes: plan.totalMinutes,
  };
}

function nowDTO(plan: Plan, at: number): z.infer<typeof NowDTO> {
  const v = nowView(plan, at, 4);
  return {
    at: new Date(at).toISOString(),
    atMs: at,
    doNow: [...v.overdue, ...v.current.filter((s) => s.kind === "active")].map((s) => s.id),
    running: v.current.filter((s) => s.kind === "passive").map((s) => ({ id: s.id, remaining: s.remaining })),
    next: v.upcoming.map((s) => ({ id: s.id, startsIn: s.startsIn })),
    minutesToServe: v.minutesToServe,
    finished: v.finished,
  };
}

/** Drops `undefined` fields: some JSON Schema validators (e.g. in browsers) reject them. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function result(r: DinnerResultT, isError = false): CallToolResult {
  return { content: [{ type: "text", text: r.speech }], structuredContent: clean(r), isError };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Builds the Sous MCP server: tools Alexa+ (or any MCP host) calls to plan a
 * multi-dish dinner, walk the cook through it, and adapt when they fall behind.
 */
export function createSousServer(deps: SousDeps): McpServer {
  const { store } = deps;
  const now = deps.now ?? (() => Date.now());
  const server = new McpServer(
    {
      name: "sous",
      title: "Sous — dinner timing for Alexa+",
      version: VERSION,
      icons: [ICON],
      websiteUrl: "https://github.com/stefansavic7/sous",
    },
    {
      instructions:
        "Sous plans multi-dish dinners so everything is ready at the same time. When someone says what they're cooking, call plan_dinner. " +
        "During cooking, call whats_next when they ask what to do, mark_step_done when they finish something, and running_late if they fall behind. " +
        "Read the `speech` field aloud; it's written for voice.",
    },
  );
  const tz = () => store.household.timeZone;

  const withPlan = (planId: string | undefined, fn: (plan: Plan) => CallToolResult): CallToolResult => {
    const plan = store.getPlan(planId);
    if (!plan) {
      return result({
        speech: "There's no dinner plan yet. Tell me what you're cooking and when you'd like to eat.",
        plan: null,
        now: null,
      });
    }
    return fn(plan);
  };

  const snapshot = (plan: Plan, speech: string, extra: Partial<DinnerResultT> = {}): CallToolResult => {
    const at = now();
    return result({ speech, plan: planDTO(plan, tz()), now: nowDTO(plan, at), ...extra });
  };

  // Ask the host's model to draft a recipe we don't know (MCP sampling), when the host supports it.
  async function draftRecipe(dish: string, ctx: ServerContext): Promise<Recipe | undefined> {
    if (!server.server.getClientCapabilities()?.sampling) return undefined;
    try {
      const res = await ctx.mcpReq.requestSampling({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Write simple home-cooking steps for "${dish}". One numbered step per line. Include how many minutes each step takes and the oven temperature if the oven is used. Skip the ingredient list and any introduction.`,
            },
          },
        ],
        systemPrompt: "You write short, safe, realistic home-cooking steps with accurate timings.",
        maxTokens: 500,
      });
      const content = Array.isArray(res.content) ? res.content : [res.content];
      const text = content.map((c) => (c && c.type === "text" ? c.text : "")).join("\n").trim();
      if (!text) return undefined;
      return store.addRecipe(parseRecipe(text, titleCase(dish)));
    } catch {
      return undefined;
    }
  }

  // Ask the person when they want to eat (MCP elicitation), when the host supports it.
  async function askServeTime(ctx: ServerContext): Promise<string | undefined> {
    if (!server.server.getClientCapabilities()?.elicitation) return undefined;
    try {
      const res = await ctx.mcpReq.elicitInput({
        mode: "form",
        message: "What time would you like to eat?",
        requestedSchema: {
          type: "object",
          properties: {
            serve_at: { type: "string", title: "Dinner time", description: 'For example "7pm", "19:30" or "in 90 minutes"' },
          },
          required: ["serve_at"],
        },
      });
      const value = res.action === "accept" ? res.content?.serve_at : undefined;
      return typeof value === "string" && value.trim() ? value : undefined;
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------- plan_dinner
  registerAppTool(
    server,
    "plan_dinner",
    {
      title: "Plan dinner timing",
      description:
        "Work out when to start every step so all dishes are ready at the same time, sharing one cook's hands, the burners and the oven. " +
        "Use when someone lists the dishes they're making. Dish names can be casual (\"salmon\", \"rice\", \"roast potatoes\") or recipes the household added. " +
        "Returns a short spoken summary plus the full timeline.",
      inputSchema: z.object({
        dishes: z.array(z.string().min(1)).min(1).max(8).describe("Dishes to cook, e.g. [\"salmon\", \"rice\", \"broccoli\"]"),
        serve_at: z
          .string()
          .optional()
          .describe('When to eat: "7pm", "19:30", "in 90 minutes" or an ISO time. Omit to ask, or to eat as soon as possible.'),
        cooks: z.number().int().min(1).max(4).optional().describe("People cooking (default from household settings, usually 1)"),
        ovens: z.number().int().min(0).max(3).optional(),
        burners: z.number().int().min(1).max(8).optional(),
      }),
      outputSchema: DinnerResult,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
...APP_TOOL_ICONS,
      _meta: { ui: { resourceUri: TIMELINE_URI } },
    },
    async ({ dishes, serve_at, cooks, ovens, burners }, ctx): Promise<CallToolResult> => {
      const recipes: Recipe[] = [];
      const unknown: string[] = [];
      for (const name of dishes) {
        const r = resolveDish(name, store.allRecipes()) ?? (await draftRecipe(name, ctx));
        if (r) recipes.push(r);
        else unknown.push(name);
      }
      if (recipes.length === 0) {
        const suggestions = dishes.flatMap((d) => findRecipes(d, store.allRecipes(), 2)).map((r) => r.name);
        return result({
          speech: `I don't have recipes for ${listJoin(unknown)} yet. You can teach me one with "add a recipe", or pick from my cookbook${suggestions.length ? `, like ${listJoin(suggestions.slice(0, 3))}` : ""}.`,
          plan: null,
          now: null,
          unknownDishes: unknown,
          suggestions,
        });
      }

      const at = now();
      const kitchen = { ...store.household.kitchen, ...(cooks ? { cooks } : {}), ...(ovens !== undefined ? { ovens } : {}), ...(burners ? { burners } : {}) };
      const units = store.household.units;
      let requested = serve_at ?? (await askServeTime(ctx));
      let serveAt = requested ? parseServeTime(requested, at, tz()) : null;
      if (requested && serveAt === null) {
        return result(
          { speech: `Sorry, I didn't catch the time "${requested}". Try something like "7pm" or "in an hour".`, plan: null, now: null },
          true,
        );
      }
      let asap = false;
      if (serveAt === null) {
        // As soon as possible: plan once to learn the length, then anchor it to now.
        const probe = planMeal(recipes, at + 6 * 3600000, { kitchen, units });
        serveAt = Math.ceil((at + (probe.totalMinutes + 1) * 60000) / 300000) * 300000;
        asap = true;
        requested = undefined;
      }

      let plan = planMeal(recipes, serveAt, { kitchen, units, now: at });
      const earliest = plan.serveAt + Math.min(...plan.steps.map((s) => s.start)) * 60000;
      let moved = "";
      if (earliest < at - 60000) {
        const { plan: fixed, movedBy } = replanFromNow(plan, at, 24 * 60);
        if (movedBy > 0) {
          plan = fixed;
          moved = `There isn't quite enough time for ${clock(plan, -movedBy, tz())}, so dinner is at ${clock(plan, 0, tz())}. `;
        }
      }
      store.savePlan(plan);
      let speech = moved + planSpeech(plan, tz(), at);
      if (asap) speech = `As soon as possible works: ${speech}`;
      if (unknown.length) speech += ` I left out ${listJoin(unknown)} because I don't have a recipe for it yet.`;
      return snapshot(plan, speech, unknown.length ? { unknownDishes: unknown } : {});
    },
  );

  // ---------------------------------------------------------------- whats_next
  registerAppTool(
    server,
    "whats_next",
    {
      title: "What's next in the kitchen",
      description:
        "Tell the cook what to do right now, what comes next and when, and which timers are running. Use for \"what's next\", \"what should I be doing\", \"how long on the salmon\".",
      inputSchema: z.object({ plan_id: z.string().optional().describe("Defaults to tonight's plan") }),
      outputSchema: DinnerResult,
      annotations: { readOnlyHint: true, openWorldHint: false },
...APP_TOOL_ICONS,
      _meta: { ui: { resourceUri: TIMELINE_URI } },
    },
    async ({ plan_id }): Promise<CallToolResult> =>
      withPlan(plan_id, (plan) => snapshot(plan, nowSpeech(plan, nowView(plan, now()), tz()))),
  );

  // ---------------------------------------------------------------- mark_step_done
  registerAppTool(
    server,
    "mark_step_done",
    {
      title: "Mark a step done",
      description:
        "Record that the cook finished a step (\"the rice is rinsed\", \"salmon's in\"). Accepts a step id or a loose description; with no step it marks what they should be doing now. Returns what's next.",
      inputSchema: z.object({
        step: z.string().optional().describe("Step id or description, e.g. \"rinsed the rice\""),
        plan_id: z.string().optional(),
      }),
      outputSchema: DinnerResult,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
...APP_TOOL_ICONS,
      _meta: { ui: { resourceUri: TIMELINE_URI } },
    },
    async ({ step, plan_id }): Promise<CallToolResult> =>
      withPlan(plan_id, (plan) => {
        const at = now();
        const view = nowView(plan, at);
        const target =
          (step && plan.steps.find((s) => s.id === step)) ||
          (step ? matchStep(plan, step, at) : undefined) ||
          [...view.overdue, ...view.current.filter((s) => s.kind === "active")][0];
        if (!target) {
          return snapshot(plan, `I'm not sure which step you mean. ${nowSpeech(plan, view, tz())}`);
        }
        let lead: string;
        if (target.kind === "passive" && !target.system) {
          lead = `Got it. ${target.dishName} will be done at ${clock(plan, target.end, tz())}.`;
          if (target.end <= (at - plan.serveAt) / 60000) {
            markDone(plan, target.id);
            lead = `Got it, ${target.dishName.toLowerCase()} is done.`;
          }
        } else {
          markDone(plan, target.id);
          lead = `Nice. ${target.dishName}: done with "${target.label.toLowerCase()}".`;
        }
        store.savePlan(plan);
        return snapshot(plan, `${lead} ${nowSpeech(plan, nowView(plan, at), tz())}`);
      }),
  );

  // ---------------------------------------------------------------- running_late
  registerAppTool(
    server,
    "running_late",
    {
      title: "Adjust for running late",
      description:
        "Re-plan when the cook is behind (\"I'm running 10 minutes late\", \"I just got home\"). By default it tries to keep the dinner time by reshuffling what hasn't started; set keep_serve_time to false to simply push dinner back.",
      inputSchema: z.object({
        minutes: z.number().int().min(1).max(180).describe("How far behind the cook is"),
        keep_serve_time: z.boolean().optional().describe("Try to keep the dinner time (default true)"),
        plan_id: z.string().optional(),
      }),
      outputSchema: DinnerResult,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
...APP_TOOL_ICONS,
      _meta: { ui: { resourceUri: TIMELINE_URI } },
    },
    async ({ minutes, keep_serve_time, plan_id }): Promise<CallToolResult> =>
      withPlan(plan_id, (plan) => {
        const at = now();
        const before = clock(plan, 0, tz());
        let next: Plan;
        let speech: string;
        if (keep_serve_time === false) {
          next = delayPlan(plan, minutes, at);
          speech = `No problem, dinner moves from ${before} to ${clock(next, 0, tz())}.`;
        } else {
          const { plan: replanned, movedBy } = replanFromNow(plan, at, minutes);
          if (movedBy < 0) {
            next = delayPlan(plan, minutes, at);
            speech = `I couldn't reshuffle it, so dinner moves to ${clock(next, 0, tz())}.`;
          } else if (movedBy === 0) {
            next = replanned;
            speech = `Good news, you can still eat at ${before}. I reshuffled the steps.`;
          } else {
            next = replanned;
            speech = `I reshuffled everything; the best I can do is ${clock(next, 0, tz())}, ${movedBy} minutes later than planned.`;
          }
        }
        store.savePlan(next);
        return snapshot(next, `${speech} ${nowSpeech(next, nowView(next, at), tz())}`);
      }),
  );

  // ---------------------------------------------------------------- find_recipes
  server.registerTool(
    "find_recipes",
    {
      title: "Find recipes",
      description: "Search the cookbook (built-in plus the household's own recipes) by dish, ingredient or kind of dish.",
      inputSchema: z.object({ query: z.string().min(1).describe("e.g. \"potato\", \"dessert\", \"chicken\"") }),
      outputSchema: z.object({
        speech: z.string(),
        recipes: z.array(z.object({ id: z.string(), name: z.string(), totalMinutes: z.number(), handsOnMinutes: z.number(), usesOven: z.boolean() })),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      icons: [ICON],
    },
    async ({ query }): Promise<CallToolResult> => {
      const found = findRecipes(query, store.allRecipes(), 6).map((r) => ({
        id: r.id,
        name: r.name,
        totalMinutes: r.steps.reduce((s, x) => s + x.minutes, 0),
        handsOnMinutes: r.steps.filter((x) => x.kind === "active").reduce((s, x) => s + x.minutes, 0),
        usesOven: r.steps.some((x) => x.resource?.type === "oven"),
      }));
      const speech = found.length
        ? `I found ${listJoin(found.map((r) => `${r.name.toLowerCase()} (${r.totalMinutes} minutes)`))}.`
        : `I didn't find anything for "${query}". You can teach me a recipe with "add a recipe".`;
      return { content: [{ type: "text", text: speech }], structuredContent: clean({ speech, recipes: found }) };
    },
  );

  // ---------------------------------------------------------------- get_recipe
  server.registerTool(
    "get_recipe",
    {
      title: "Read a recipe",
      description: "Get the steps, timings and oven temperatures of one recipe, to read aloud or show.",
      inputSchema: z.object({ recipe: z.string().min(1).describe("Recipe id or dish name") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      icons: [ICON],
    },
    async ({ recipe }): Promise<CallToolResult> => {
      const r = store.getRecipe(recipe) ?? resolveDish(recipe, store.allRecipes());
      if (!r) return { content: [{ type: "text", text: `I don't have a recipe called "${recipe}".` }], isError: true };
      const units = store.household.units;
      const lines = r.steps.map((s, i) => {
        const where = s.resource?.type === "oven" ? ` (oven, ${formatTemp(s.resource.tempC, units)})` : s.resource?.type === "burner" ? " (stovetop)" : "";
        return `${i + 1}. ${s.label} — ${s.minutes} min${where}`;
      });
      return { content: [{ type: "text", text: `${r.name}\n${lines.join("\n")}` }] };
    },
  );

  // ---------------------------------------------------------------- add_recipe
  server.registerTool(
    "add_recipe",
    {
      title: "Teach Sous a recipe",
      description:
        "Save a family recipe from free text (pasted or dictated). Sous extracts steps, timings, oven temperatures and which steps need hands, so it can be planned with other dishes.",
      inputSchema: z.object({
        text: z.string().min(10).describe("The recipe method, e.g. \"Preheat oven to 400F. Roast the squash 35 minutes...\""),
        name: z.string().optional().describe("Dish name, if not the first line of the text"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      icons: [ICON],
    },
    async ({ text, name }): Promise<CallToolResult> => {
      const r = store.addRecipe(parseRecipe(text, name));
      const total = r.steps.reduce((s, x) => s + x.minutes, 0);
      const oven = r.steps.find((s) => s.resource?.type === "oven");
      const units = store.household.units;
      const speech =
        `Saved ${r.name}: ${r.steps.length} steps, about ${total} minutes` +
        (oven && oven.resource?.type === "oven" ? `, with the oven at ${formatTemp(oven.resource.tempC, units)}` : "") +
        `. You can now plan it with other dishes.`;
      return { content: [{ type: "text", text: speech }], structuredContent: clean({ speech, recipe: r }) };
    },
  );

  // ---------------------------------------------------------------- set_kitchen
  server.registerTool(
    "set_kitchen",
    {
      title: "Set up the kitchen",
      description:
        "Remember the household's kitchen and preferences: number of cooks, ovens, burners, dishes per oven, temperature units and time zone.",
      inputSchema: z.object({
        cooks: z.number().int().min(1).max(4).optional(),
        ovens: z.number().int().min(0).max(3).optional(),
        burners: z.number().int().min(1).max(8).optional(),
        racks_per_oven: z.number().int().min(1).max(4).optional(),
        units: z.enum(["F", "C"]).optional(),
        timezone: z.string().optional().describe("IANA time zone, e.g. America/Chicago"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      icons: [ICON],
    },
    async ({ cooks, ovens, burners, racks_per_oven, units, timezone }): Promise<CallToolResult> => {
      if (timezone) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        } catch {
          return { content: [{ type: "text", text: `"${timezone}" isn't a time zone I know.` }], isError: true };
        }
      }
      const h = store.updateHousehold({
        kitchen: {
          ...(cooks ? { cooks } : {}),
          ...(ovens !== undefined ? { ovens } : {}),
          ...(burners ? { burners } : {}),
          ...(racks_per_oven ? { racksPerOven: racks_per_oven } : {}),
        },
        ...(units ? { units } : {}),
        ...(timezone ? { timeZone: timezone } : {}),
      });
      const k = h.kitchen;
      const speech = `Got it: ${k.cooks ?? 1} cook${(k.cooks ?? 1) > 1 ? "s" : ""}, ${k.ovens ?? 1} oven${(k.ovens ?? 1) === 1 ? "" : "s"}, ${k.burners ?? 4} burners, temperatures in ${h.units === "F" ? "Fahrenheit" : "Celsius"}.`;
      return { content: [{ type: "text", text: speech }], structuredContent: clean({ speech, household: h }) };
    },
  );

  // ---------------------------------------------------------------- resources
  registerAppResource(server, "Dinner timeline", TIMELINE_URI, { mimeType: RESOURCE_MIME_TYPE, description: "Echo Show view of tonight's dinner timeline" }, async (): Promise<ReadResourceResult> => ({
    contents: [{ uri: TIMELINE_URI, mimeType: RESOURCE_MIME_TYPE, text: await deps.timelineHtml() }],
  }));

  server.registerResource(
    "recipe",
    new ResourceTemplate("sous://recipes/{id}", {
      list: async () => ({
        resources: store.allRecipes().map((r) => ({ uri: `sous://recipes/${r.id}`, name: r.name, mimeType: "application/json" })),
      }),
    }),
    { title: "Recipe", description: "A recipe with schedulable steps", mimeType: "application/json" },
    async (uri, variables): Promise<ReadResourceResult> => {
      const id = String(variables.id);
      const r = store.getRecipe(id);
      if (!r) throw new Error(`No recipe with id ${id}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerResource(
    "current-plan",
    "sous://plans/current",
    { title: "Tonight's plan", description: "The current dinner plan with every step's time", mimeType: "application/json" },
    async (uri): Promise<ReadResourceResult> => {
      const plan = store.getPlan();
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(plan ? planDTO(plan, tz()) : null, null, 2) }],
      };
    },
  );

  // ---------------------------------------------------------------- prompts
  server.registerPrompt(
    "plan_dinner_party",
    {
      title: "Plan a dinner",
      description: "Plan a multi-dish dinner and cook along with Sous",
      argsSchema: z.object({
        dishes: z.string().describe("Comma-separated dishes"),
        time: z.string().optional().describe("When to eat"),
      }),
      icons: [ICON],
    },
    ({ dishes, time }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I'm cooking ${dishes}${time ? ` and want to eat ${time}` : ""}. Use Sous to plan the timing, then walk me through it step by step.`,
          },
        },
      ],
    }),
  );

  return server;
}
