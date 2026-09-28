import type { Recipe, RecipeStep, Resource } from "./types.ts";

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, forty: 40, "forty-five": 45,
  fifty: 50, sixty: 60, ninety: 90,
};

const PASSIVE_VERB =
  /\b(bake|baking|roast|roasting|simmer|simmering|rest|resting|marinate|chill|refrigerate|rise|proof|braise|steam|boil|cool|soak|steep|sit|stand|cook(?:,)? covered|leave|let)\b/i;
const OVEN_WORD = /\b(bake|baked|baking|roast|roasting|broil|oven|preheat)\b/i;
const BURNER_WORD =
  /\b(simmer|boil|boiling|saut[eé]|fry|sear|steam|skillet|pan|pot|saucepan|wok|stovetop|burner|griddle|blanch|poach|reduce|stir-fry)\b/i;
const SERVE = /^\s*(serve|enjoy|garnish and serve)\b/i;

/** Parses "10-12 minutes", "1 1/2 hours", "half an hour", "an hour and 15 minutes". Returns minutes or null. */
export function parseDuration(text: string, prefer: "max" | "mean" = "max"): number | null {
  const t = text.toLowerCase().replace(/–|—/g, "-");
  let total = 0;
  let found = false;

  if (/\ban hour and a half\b/.test(t)) return 90;
  let text2 = t;
  if (/\bhalf an? hour\b/.test(t)) {
    total += 30;
    found = true;
    text2 = t.replace(/\bhalf an? hour\b/g, " ");
  }

  const frac = t.match(/(\d+)\s+(\d)\/(\d)\s*(?:hours?|hrs?)\b/);
  if (frac) {
    total += (Number(frac[1]) + Number(frac[2]) / Number(frac[3])) * 60;
    found = true;
  }

  const num = "(\\d+(?:[.,]\\d+)?|" + Object.keys(WORD_NUMBERS).join("|") + ")";
  const toNum = (s: string) => (s in WORD_NUMBERS ? WORD_NUMBERS[s] : Number(s.replace(",", ".")));
  const range = new RegExp(`${num}\\s*(?:-|to|or)\\s*${num}\\s*(minutes?|mins?|hours?|hrs?)\\b`, "g");
  const single = new RegExp(`(?:^|[^\\d/-])${num}\\s*(minutes?|mins?|m\\b|hours?|hrs?|h\\b)`, "g");

  let rest = text2;
  if (!frac) {
    for (const m of text2.matchAll(range)) {
      const a = toNum(m[1]);
      const b = toNum(m[2]);
      const unit = m[3].startsWith("h") ? 60 : 1;
      total += (prefer === "max" ? Math.max(a, b) : (a + b) / 2) * unit;
      found = true;
      rest = rest.replace(m[0], " ");
    }
    for (const m of rest.matchAll(single)) {
      const unit = m[2].startsWith("h") ? 60 : 1;
      total += toNum(m[1]) * unit;
      found = true;
    }
  }
  return found ? Math.max(1, Math.round(total)) : null;
}

/** Finds an oven temperature and returns it in Celsius. */
export function parseTemperature(text: string): number | null {
  const t = text.replace(/º/g, "°");
  const gas = t.match(/gas mark\s*(\d)/i);
  if (gas) return [140, 150, 165, 180, 190, 200, 220, 230, 240][Number(gas[1]) - 1] ?? null;
  const m = t.match(/(\d{3})\s*(?:°|degrees?)?\s*(f|c|fahrenheit|celsius)?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 90 || n > 550) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const isF = unit.startsWith("f") || (!unit && n >= 260);
  return isF ? Math.round(((n - 32) * 5) / 9 / 5) * 5 : n;
}

function defaultMinutes(sentence: string): number {
  const s = sentence.toLowerCase();
  if (/\b(bring|boil) .*\bboil\b|\bbring to a boil\b/.test(s)) return 8;
  if (/\b(chop|dice|slice|mince|peel|grate|trim|cut)\b/.test(s)) return 5;
  if (/\b(sear|saut[eé]|fry|brown)\b/.test(s)) return 5;
  if (/\b(mash)\b/.test(s)) return 4;
  if (/\b(assemble|shape|form|roll)\b/.test(s)) return 4;
  if (/\b(mix|whisk|stir|combine|season|toss|blend|dress|pour)\b/.test(s)) return 2;
  if (/\b(drain|flip|transfer)\b/.test(s)) return 1;
  return 3;
}

/** Keeps a label short and imperative for voice. */
function tidyLabel(sentence: string): string {
  const s = sentence.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, "").replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
  return s.length > 90 ? `${s.slice(0, 87).replace(/\s+\S*$/, "")}…` : s;
}

function splitInstructions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

export function guessHoldMinutes(name: string): number {
  const n = name.toLowerCase();
  if (/salad|slaw|dessert|cake|brownie|cookie|pie|tart|bread|dip|salsa|hummus/.test(n)) return 45;
  if (/soup|stew|chili|curry|sauce|rice|couscous|quinoa|beans|lentil|mash|mashed|pur[eé]e/.test(n)) return 20;
  if (/roast(ed)? (potato|vegetable|veg|carrot|broccoli)|potato|gratin/.test(n)) return 10;
  if (/pasta|spaghetti|noodle|risotto|souffl|fries|tempura/.test(n)) return 3;
  if (/salmon|fish|shrimp|prawn|scallop|steak|egg|omelet/.test(n)) return 4;
  if (/chicken|pork|lamb|beef|turkey|roast/.test(n)) return 10;
  return 10;
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/**
 * Turns free recipe text into structured, schedulable steps using simple rules:
 * durations, oven temperatures, and whether a step needs hands or just time.
 */
export function parseRecipe(text: string, name?: string): Recipe {
  const lines = splitInstructions(text);
  let title = name?.trim();
  if (!title && lines.length && !/\d/.test(lines[0]) && lines[0].split(" ").length <= 8 && !/[.!?]$/.test(lines[0])) {
    title = lines.shift();
  }
  title = title || "My recipe";

  let ovenTemp: number | null = null;
  const steps: RecipeStep[] = [];
  for (const raw of lines) {
    if (SERVE.test(raw)) continue;
    const temp = parseTemperature(raw);
    if (/\bpreheat\b/i.test(raw)) {
      if (temp) ovenTemp = temp;
      continue; // the planner adds preheating on its own
    }
    const usesOven = OVEN_WORD.test(raw);
    if (usesOven && temp) ovenTemp = temp;
    const passive = PASSIVE_VERB.test(raw);
    const minutes = parseDuration(raw, passive ? "max" : "mean") ?? defaultMinutes(raw);
    let resource: Resource = { type: "none" };
    if (usesOven) resource = { type: "oven", tempC: temp ?? ovenTemp ?? 200 };
    else if (BURNER_WORD.test(raw)) resource = { type: "burner" };
    const kind = passive && minutes >= 3 ? "passive" : "active";
    steps.push({
      label: tidyLabel(raw),
      minutes,
      kind,
      resource,
      canWaitAfter: kind === "active" && resource.type === "none",
    });
  }
  if (steps.length === 0) {
    steps.push({ label: tidyLabel(text).slice(0, 80) || "Cook", minutes: 10, kind: "active", resource: { type: "none" } });
  }
  if (/cake|brownie|cookie|bread|pie|tart|muffin|souffl|pastry|biscuit|scone|loaf|crumble/i.test(title)) {
    for (const st of steps) if (st.resource?.type === "oven") st.exactTemp = true;
  }
  return {
    id: `${slug(title)}-${Math.random().toString(36).slice(2, 6)}`,
    name: title,
    holdMinutes: guessHoldMinutes(title),
    steps,
    source: "user",
  };
}
