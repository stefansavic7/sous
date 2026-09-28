/**
 * A tiny rule-based stand-in for Alexa+'s language model, so the simulator runs
 * without accounts or API keys. It only maps an utterance to one Sous tool call;
 * everything after that (MCP, planning, the Echo Show view) is the real thing.
 */
export type Intent =
  | { tool: "plan_dinner"; args: { dishes: string[]; serve_at?: string; cooks?: number } }
  | { tool: "whats_next"; args: Record<string, never> }
  | { tool: "mark_step_done"; args: { step?: string } }
  | { tool: "running_late"; args: { minutes: number; keep_serve_time?: boolean } }
  | { tool: "find_recipes"; args: { query: string } }
  | { tool: "get_recipe"; args: { recipe: string } }
  | { tool: "add_recipe"; args: { text: string; name?: string } }
  | { tool: "set_kitchen"; args: { cooks?: number; ovens?: number; burners?: number; units?: "F" | "C" } }
  | { tool: null; reply: string; openRecipeForm?: boolean };

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10,
  fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, forty: 40, "forty-five": 45, few: 5, couple: 2,
};
const num = (s: string | undefined, fallback: number): number => {
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : WORDS[s.toLowerCase()] ?? fallback;
};

const TIME =
  "(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|noon|midnight|in (?:about )?(?:an?|\\d+(?:\\.\\d+)?) (?:hours?|minutes?|mins?)|in half an hour)";

export const HELP =
  'Try: "I\'m making salmon, rice and broccoli for 7", "what\'s next?", "the rice is rinsed", "I\'m running 10 minutes late", or "add a recipe".';

function splitDishes(text: string): string[] {
  return text
    .replace(/\b(tonight|for dinner|dinner|please|thanks?)\b/gi, " ")
    .split(/,|\band\b|\bplus\b|&|\bwith a side of\b|\bwith\b/i)
    .map((d) => d.replace(/^\s*(some|a|an|the|my|our)\s+/i, "").replace(/[.!?]+$/, "").trim())
    .filter((d) => d.length > 1);
}

export function understand(raw: string): Intent {
  const u = raw.trim().replace(/^(alexa|hey alexa|ok alexa)[,!\s]*/i, "");
  const l = u.toLowerCase();
  if (!l) return { tool: null, reply: HELP };

  if (/\b(help|what can you do)\b/.test(l)) return { tool: null, reply: `I time whole dinners so everything is ready together. ${HELP}` };

  if (/\b(add|save|teach you|remember|learn)\b.*\brecipe\b/.test(l)) {
    const after = u.split(/recipe[:\s-]*/i)[1]?.trim();
    if (after && after.length > 20) return { tool: "add_recipe", args: { text: after } };
    return { tool: null, reply: "Sure, paste or dictate the recipe and I'll learn it.", openRecipeForm: true };
  }

  if (/\bwhat('?s| is) next\b|\bwhat (should|do) i do\b|\bwhat now\b|\bhow long\b|\bwhere am i\b|\bstatus\b/.test(l)) {
    return { tool: "whats_next", args: {} };
  }

  const late = l.match(/\b(\d+|a few|few|five|ten|fifteen|twenty|thirty|a couple of)\s*(?:more\s+)?min(?:ute)?s?\s+(?:late|behind)\b/);
  if (late) return { tool: "running_late", args: { minutes: num(late[1].replace(/^a (few|couple of)$/, "$1").replace(" of", ""), 10) } };
  if (/\brunning late\b|\bfell behind\b|\bi'?m behind\b|\bjust got home\b/.test(l)) return { tool: "running_late", args: { minutes: 10 } };
  const push = l.match(/\b(?:push|move)\s+(?:dinner|it|everything)?\s*back\s+(?:by\s+)?(\d+|ten|fifteen|twenty|thirty)/);
  if (push) return { tool: "running_late", args: { minutes: num(push[1], 15), keep_serve_time: false } };

  const ovens = l.match(/\b(\d|one|two|three)\s+ovens?\b/);
  const burners = l.match(/\b(\d|two|three|four|five|six|eight)\s+(?:burners|rings|hobs)\b/);
  const helper = /\b(my|a)\s+(wife|husband|partner|friend|kid|son|daughter|roommate|mom|dad)\s+is\s+helping\b|\btwo of us\b|\bwe are two\b/.test(l);
  const units = /\bfahrenheit\b/.test(l) ? "F" : /\bcelsius\b/.test(l) ? "C" : undefined;
  const planVerb = l.match(/\b(?:i'?m|we'?re|i am|we are)?\s*(?:making|cooking|having|doing|preparing|planning|plan|cook|make)\b\s*(?:dinner|a dinner)?\s*[:\-]?\s*(.+)/);
  if ((ovens || burners || helper || units) && !planVerb) {
    return {
      tool: "set_kitchen",
      args: {
        ...(ovens ? { ovens: num(ovens[1], 1) } : {}),
        ...(burners ? { burners: num(burners[1], 4) } : {}),
        ...(helper ? { cooks: 2 } : {}),
        ...(units ? { units } : {}),
      },
    };
  }

  const find = l.match(/\b(?:find|search|show me|any|got|suggest)\s+(?:me\s+)?(?:a\s+|some\s+)?(?:recipes?|dishes?|ideas?)\s*(?:for|with|using)?\s*(.*)$/) ?? l.match(/\bwhat can i (?:make|cook) with (.+)/);
  if (find) return { tool: "find_recipes", args: { query: (find[1] || "dinner").replace(/[?.!]+$/, "") } };
  const read = u.match(/\b(?:how do (?:i|you) (?:make|cook)|recipe for|read (?:me )?the recipe for|steps for)\s+(.+?)[?.!]*$/i);
  if (read) return { tool: "get_recipe", args: { recipe: read[1] } };

  if (planVerb) {
    let rest = planVerb[1];
    let serve_at: string | undefined;
    const t = rest.match(new RegExp(`\\s*(?:,\\s*)?(?:for|at|by|ready (?:at|by)|around|served at|to eat at)\\s+${TIME}\\s*[.!?]*\\s*$`, "i"));
    if (t) {
      serve_at = t[1];
      rest = rest.slice(0, t.index);
    } else {
      const t2 = rest.match(new RegExp(`\\s+${TIME}\\s*[.!?]*\\s*$`, "i"));
      if (t2 && /\d|noon|in /.test(t2[1])) {
        serve_at = t2[1];
        rest = rest.slice(0, t2.index);
      }
    }
    const dishes = splitDishes(rest);
    if (dishes.length) return { tool: "plan_dinner", args: { dishes, ...(serve_at ? { serve_at } : {}), ...(helper ? { cooks: 2 } : {}) } };
  }

  if (/\b(done|finished|ready|rinsed|chopped|seasoned|peeled|trimmed|sliced|mixed|mashed|drained|blended|whisked|in the oven|is in|are in|went in|on the stove|boiling|simmering|resting|preheated|hot)\b/.test(l)) {
    const generic = /^(ok(ay)?[, ]*)?(i'?m |it'?s |that'?s |all )?(done|finished|ready)[.!]*$/.test(l);
    return { tool: "mark_step_done", args: generic ? {} : { step: u } };
  }

  return { tool: null, reply: `Sorry, I can help with dinner timing. ${HELP}` };
}
