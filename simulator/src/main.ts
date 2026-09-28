import type { CallToolResult } from "@modelcontextprotocol/client";
import { connectInBrowser, connectRemote, SimClock, type Connection, type Direction } from "./connection.ts";
import { EchoShowScreen } from "./device.ts";
import { HELP, understand, type Intent } from "./nlu.ts";
import "./sim.css";

type Step = { id: string; dishId: string; dish: string; label: string; kind: "active" | "passive"; start: number; end: number; status: string; system: boolean };
type Dinner = { speech: string; plan: null | { id: string; serveAtMs: number; steps: Step[] } };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  screen: $("screen"),
  idle: $("idle"),
  lightbar: $("lightbar"),
  caption: $("caption"),
  transcript: $<HTMLOListElement>("transcript"),
  chips: $("chips"),
  form: $<HTMLFormElement>("sayForm"),
  input: $<HTMLInputElement>("sayInput"),
  mic: $<HTMLButtonElement>("mic"),
  traffic: $<HTMLOListElement>("traffic"),
  trafficCount: $("trafficCount"),
  mode: $<HTMLSelectElement>("serverMode"),
  url: $<HTMLInputElement>("serverUrl"),
  token: $<HTMLInputElement>("serverToken"),
  connectBtn: $<HTMLButtonElement>("connectBtn"),
  status: $("connStatus"),
  warp: $("warp"),
  clockLabel: $("clockLabel"),
  voice: $<HTMLInputElement>("voice"),
  recipeDialog: $<HTMLDialogElement>("recipeDialog"),
  recipeText: $<HTMLTextAreaElement>("recipeText"),
  recipeName: $<HTMLInputElement>("recipeName"),
  recipeForm: $<HTMLFormElement>("recipeForm"),
};

const clock = new SimClock();
// ?t=18:05 starts the demo clock at 6:05 PM (only affects the in-page server).
const startParam = new URLSearchParams(location.search).get("t");
if (startParam) clock.startAt(startParam);
let conn: Connection | undefined;
let screen: EchoShowScreen | undefined;
let lastPlan: Dinner["plan"] = null;
let pendingElicit: ((answer: string | null) => void) | null = null;
let trafficN = 0;

// ---------------------------------------------------------------- voice
let voice: SpeechSynthesisVoice | undefined;
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const prefer = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Ava", "Allison"];
  voice = voices.find((v) => prefer.some((p) => v.name.includes(p))) ?? voices.find((v) => v.lang === "en-US") ?? voices.find((v) => v.lang.startsWith("en"));
}
if ("speechSynthesis" in window) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text: string) {
  ui.caption.textContent = text;
  ui.caption.classList.add("show");
  ui.lightbar.classList.add("speaking");
  const done = () => {
    ui.lightbar.classList.remove("speaking");
    setTimeout(() => ui.caption.classList.remove("show"), 2500);
  };
  if (!ui.voice.checked || !("speechSynthesis" in window)) {
    setTimeout(done, Math.min(8000, 1200 + text.length * 45));
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.03;
  u.onend = done;
  u.onerror = done;
  window.speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- transcript
function bubble(who: "you" | "alexa" | "system", text: string, note?: string) {
  const li = document.createElement("li");
  li.className = `msg ${who}`;
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  li.append(body);
  if (note) {
    const n = document.createElement("div");
    n.className = "note";
    n.textContent = note;
    li.append(n);
  }
  ui.transcript.append(li);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

// ---------------------------------------------------------------- MCP traffic log
function summarize(m: Record<string, unknown>): string {
  const params = m.params as Record<string, unknown> | undefined;
  if (typeof m.method === "string") {
    if (m.method === "tools/call") return `tools/call ${String(params?.name)} ${JSON.stringify(params?.arguments ?? {})}`;
    if (m.method === "resources/read") return `resources/read ${String(params?.uri)}`;
    if (m.method === "elicitation/create") return `elicitation/create “${String(params?.message)}”`;
    return String(m.method);
  }
  if (m.error) return `error ${JSON.stringify(m.error)}`;
  const r = m.result as Record<string, unknown> | undefined;
  if (r?.protocolVersion) return `initialize result · protocol ${String(r.protocolVersion)}`;
  if (r?.tools) return `${(r.tools as unknown[]).length} tools`;
  if (r?.structuredContent && (r.structuredContent as { speech?: string }).speech) return `result · “${(r.structuredContent as { speech: string }).speech.slice(0, 90)}…”`;
  if (r?.contents) return `resource · ${(r.contents as Array<{ mimeType?: string }>)[0]?.mimeType ?? ""}`;
  return "result";
}

function onTraffic(direction: Direction, message: unknown) {
  const m = message as Record<string, unknown>;
  trafficN++;
  ui.trafficCount.textContent = String(trafficN);
  const li = document.createElement("li");
  li.className = direction;
  const d = document.createElement("details");
  const s = document.createElement("summary");
  s.textContent = `${direction === "out" ? "→" : "←"} ${summarize(m)}`;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(m, (k, v) => (k === "text" && typeof v === "string" && v.length > 400 ? `${v.slice(0, 400)}… (${v.length} chars)` : v), 2);
  d.append(s, pre);
  li.append(d);
  ui.traffic.append(li);
  while (ui.traffic.children.length > 300) ui.traffic.firstElementChild?.remove();
  ui.traffic.scrollTop = ui.traffic.scrollHeight;
}

// ---------------------------------------------------------------- elicitation (server asks the user)
async function onElicit(message: string): Promise<Record<string, string> | null> {
  bubble("alexa", message, "Sous asked this through MCP elicitation");
  speak(message);
  const answer = await new Promise<string | null>((resolve) => {
    pendingElicit = resolve;
  });
  return answer ? { serve_at: answer } : null;
}

// ---------------------------------------------------------------- tool calls
function remember(result: CallToolResult) {
  const d = result.structuredContent as Dinner | undefined;
  if (d && "plan" in d) {
    lastPlan = d.plan;
    announced.clear();
    if (lastPlan) {
      const t = minutesNow(lastPlan);
      for (const s of lastPlan.steps) {
        if (s.start <= t) announced.add(`start:${s.id}`);
        if (s.end <= t) announced.add(`end:${s.id}`);
      }
      if (t >= 0) announced.add("serve");
    }
  }
}

async function run(intent: Intent) {
  if (!conn) return;
  if (intent.tool === null) {
    bubble("alexa", intent.reply);
    speak(intent.reply);
    if (intent.openRecipeForm) ui.recipeDialog.showModal();
    return;
  }
  ui.lightbar.classList.add("thinking");
  try {
    const result = (await conn.client.callTool({ name: intent.tool, arguments: intent.args })) as CallToolResult;
    const text =
      (result.structuredContent as { speech?: string } | undefined)?.speech ??
      (result.content as Array<{ type: string; text?: string }>).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    remember(result);
    bubble("alexa", text, `${intent.tool}(${JSON.stringify(intent.args)})`);
    speak(text);
    if (screen?.hasUi(intent.tool)) {
      ui.idle.hidden = true;
      await screen.show(intent.tool, intent.args as Record<string, unknown>, result);
    }
  } catch (e) {
    const msg = `Something went wrong talking to Sous: ${(e as Error).message}`;
    bubble("system", msg);
  } finally {
    ui.lightbar.classList.remove("thinking");
  }
}

function handleUtterance(text: string) {
  const said = text.trim();
  if (!said) return;
  bubble("you", said);
  if (pendingElicit) {
    const resolve = pendingElicit;
    pendingElicit = null;
    resolve(/^(cancel|never ?mind|no|skip)\b/i.test(said) ? null : said);
    return;
  }
  void run(understand(said));
}

// ---------------------------------------------------------------- proactive cues (Alexa speaks up on time)
const announced = new Set<string>();
function nowMs(): number {
  return conn?.simulatedClock ? clock.now() : Date.now();
}
function minutesNow(plan: NonNullable<Dinner["plan"]>): number {
  return (nowMs() - plan.serveAtMs) / 60000;
}
function lower(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

setInterval(() => {
  updateClockLabel();
  const plan = lastPlan;
  if (!plan) return;
  const t = minutesNow(plan);
  const lines: string[] = [];
  for (const s of plan.steps) {
    if (s.status === "done") continue;
    if (!announced.has(`start:${s.id}`) && t >= s.start) {
      announced.add(`start:${s.id}`);
      if (t - s.start < 3) lines.push(s.system ? `${s.label}.` : s.kind === "active" ? `${s.dish}: time to ${lower(s.label)}.` : `${s.label}.`);
    }
    if (!announced.has(`end:${s.id}`) && t >= s.end) {
      announced.add(`end:${s.id}`);
      const last = plan.steps.filter((x) => x.dishId === s.dishId).every((x) => x.end <= s.end);
      if (!s.system && s.kind === "passive" && last && s.end < 0 && t - s.end < 3) lines.push(`The ${s.dish.toLowerCase()} is ready.`);
      if (s.system && t - s.end < 3) lines.push("The oven is hot.");
    }
  }
  if (!announced.has("serve") && t >= 0) {
    announced.add("serve");
    lines.push("Dinner is ready. Enjoy!");
  }
  if (lines.length) {
    const text = lines.slice(0, 3).join(" ");
    bubble("alexa", text, "proactive cue");
    speak(text);
  }
}, 500);

const idleTime = document.getElementById("idleTime")!;
function updateClockLabel() {
  const d = new Date(nowMs());
  idleTime.textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  ui.clockLabel.textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: conn?.simulatedClock && clock.rate > 1 ? undefined : "2-digit" });
}

// ---------------------------------------------------------------- connection
async function connect() {
  ui.status.textContent = "Connecting…";
  ui.status.className = "status";
  try {
    await conn?.close().catch(() => {});
    conn = undefined;
    ui.screen.querySelectorAll("iframe").forEach((f) => f.remove());
    ui.idle.hidden = false;
    lastPlan = null;
    if (ui.mode.value === "remote") {
      conn = await connectRemote(ui.url.value.trim() || "http://localhost:3001/mcp", ui.token.value.trim() || undefined, onTraffic, onElicit);
    } else {
      conn = await connectInBrowser(clock, onTraffic, onElicit);
    }
    screen = new EchoShowScreen(ui.screen, conn.client, {
      clockRate: () => (conn?.simulatedClock ? clock.rate : 1),
      theme: () => "dark",
      onScreenToolCall: (name, _args, result) => {
        remember(result);
        const text = (result.structuredContent as { speech?: string } | undefined)?.speech;
        if (text) {
          bubble("alexa", text, `tapped on screen → ${name}`);
          speak(text);
        }
      },
    });
    await screen.init();
    const v = conn.client.getServerVersion();
    ui.status.textContent = `${v?.title ?? v?.name} ${v?.version ?? ""} · ${conn.label}`;
    ui.status.className = "status ok";
    ui.warp.classList.toggle("disabled", !conn.simulatedClock);
  } catch (e) {
    ui.status.textContent = `Couldn't connect: ${(e as Error).message}`;
    ui.status.className = "status err";
  }
}

ui.mode.addEventListener("change", () => {
  const remote = ui.mode.value === "remote";
  ui.url.hidden = !remote;
  ui.token.hidden = !remote;
  ui.connectBtn.hidden = !remote;
  if (!remote) void connect();
});
ui.connectBtn.addEventListener("click", () => void connect());

// ---------------------------------------------------------------- input
ui.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = ui.input.value;
  ui.input.value = "";
  handleUtterance(text);
});
ui.chips.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (b?.dataset.say) handleUtterance(b.dataset.say);
});

ui.warp.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b || !conn?.simulatedClock) return;
  if (b.dataset.jump) clock.jump(Number(b.dataset.jump));
  if (b.dataset.rate) {
    clock.setRate(Number(b.dataset.rate));
    ui.warp.querySelectorAll("button[data-rate]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }
  screen?.setClock(clock.rate, clock.now());
});

// Speech recognition where the browser supports it.
type SR = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void };
const SRCtor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
if (SRCtor) {
  const rec = new SRCtor();
  rec.lang = "en-US";
  rec.interimResults = false;
  let listening = false;
  rec.onresult = (e) => handleUtterance(e.results[0][0].transcript);
  rec.onend = () => {
    listening = false;
    ui.mic.classList.remove("on");
    ui.lightbar.classList.remove("listening");
  };
  ui.mic.addEventListener("click", () => {
    if (listening) return rec.stop();
    listening = true;
    ui.mic.classList.add("on");
    ui.lightbar.classList.add("listening");
    rec.start();
  });
} else {
  ui.mic.hidden = true;
}

// Recipe form
ui.recipeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = ui.recipeText.value.trim();
  if ((e.submitter as HTMLButtonElement | null)?.value === "cancel" || text.length < 10) {
    ui.recipeDialog.close();
    return;
  }
  ui.recipeDialog.close();
  bubble("you", `(recipe) ${ui.recipeName.value || text.split("\n")[0]}`);
  void run({ tool: "add_recipe", args: { text, ...(ui.recipeName.value.trim() ? { name: ui.recipeName.value.trim() } : {}) } });
  ui.recipeText.value = "";
  ui.recipeName.value = "";
});

bubble("alexa", `Hi! I'm Alexa with Sous, a dinner-timing skill. ${HELP}`);
void connect();
