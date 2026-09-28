import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import "./timeline.css";

type Step = {
  id: string;
  dishId: string;
  dish: string;
  label: string;
  kind: "active" | "passive";
  resource: "oven" | "burner" | "none";
  temp?: string;
  start: number;
  end: number;
  startAt: string;
  endAt: string;
  status: "pending" | "done";
  system: boolean;
};
type Dinner = {
  speech: string;
  plan: null | {
    id: string;
    serveAt: string;
    serveAtMs: number;
    timeZone: string;
    units: "C" | "F";
    dishes: Array<{ id: string; name: string; readyAt: string; waits: number; holdMinutes: number }>;
    steps: Step[];
    warnings: string[];
    activeMinutes: number;
    totalMinutes: number;
  };
  now: null | { atMs: number };
};

const PALETTE = ["#f3c969", "#8fcf9f", "#7fb6ff", "#e39ad8", "#ffb27a", "#9fe0e0", "#d7e37a", "#c3a6ff"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  app: $("app"),
  serveTime: $("serveTime"),
  countdown: $("countdown"),
  dishes: $("dishes"),
  nowCard: document.querySelector(".now") as HTMLElement,
  nowLabel: $("nowLabel"),
  nowDish: $("nowDish"),
  nowTitle: $("nowTitle"),
  nowMeta: $("nowMeta"),
  doneBtn: $<HTMLButtonElement>("doneBtn"),
  lateBtn: $<HTMLButtonElement>("lateBtn"),
  timers: $("timers"),
  upnext: $("upnext"),
  lanes: $("lanes"),
  axis: $("axis"),
  note: $("note"),
};

let dinner: Dinner | null = null;
// The server's clock can differ from ours (and hosts may fast-forward it for demos),
// so time is tracked as: server time at last sync + elapsed local time × rate.
const clock = { base: Date.now(), realAt: Date.now(), rate: 1 };
let doNowId: string | null = null;

const app = new App({ name: "Sous timeline", version: "0.1.0" });

function nowMs(): number {
  return clock.base + (Date.now() - clock.realAt) * clock.rate;
}

function syncClock(serverNow: number) {
  clock.base = serverNow;
  clock.realAt = Date.now();
}

function fmtClock(ms: number): string {
  const tz = dinner?.plan?.timeZone;
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

function fmtLeft(minutesFloat: number): string {
  const total = Math.max(0, Math.round(minutesFloat * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function humanIn(minutes: number): string {
  if (minutes <= 0.5) return "now";
  const m = Math.round(minutes);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h} h ${m % 60} min`;
}

function colorFor(dishId: string): string {
  if (dishId === "oven") return "var(--ember)";
  const ids = dinner?.plan?.dishes.map((d) => d.id) ?? [];
  const i = Math.max(0, ids.indexOf(dishId));
  return PALETTE[i % PALETTE.length];
}

function setNote(text: string, warn = false) {
  el.note.textContent = text;
  el.note.classList.toggle("warn", warn);
}

function apply(d: Dinner | undefined) {
  if (!d || typeof d !== "object" || !("speech" in d)) return;
  dinner = d;
  if (d.now?.atMs) syncClock(d.now.atMs);
  setNote(d.plan?.warnings?.[0] ?? "");
  render();
}

function render() {
  const plan = dinner?.plan;
  el.app.classList.toggle("is-empty", !plan);
  if (!plan) {
    el.serveTime.textContent = "—";
    el.countdown.textContent = "";
    el.dishes.innerHTML = "";
    el.nowLabel.textContent = "Sous";
    el.nowDish.textContent = "";
    el.nowTitle.textContent = dinner?.speech ?? "Tell Alexa what you're cooking";
    el.nowMeta.textContent = 'For example: "Alexa, I\'m making salmon, rice and broccoli for 7."';
    el.doneBtn.hidden = true;
    el.lateBtn.hidden = true;
    return;
  }

  const t = (nowMs() - plan.serveAtMs) / 60000; // minutes relative to serving
  el.serveTime.textContent = fmtClock(plan.serveAtMs);
  el.countdown.textContent = t < 0 ? humanIn(-t) : t < 30 ? "Dinner is served" : "";

  // dish chips
  el.dishes.innerHTML = "";
  for (const d of plan.dishes) {
    const li = document.createElement("li");
    const ready = Date.parse(d.readyAt) <= nowMs();
    li.className = ready ? "ready" : "";
    li.innerHTML = `<span class="dot"></span>`;
    li.append(document.createTextNode(ready ? `${d.name} ✓` : d.name));
    li.style.setProperty("--c", colorFor(d.id));
    el.dishes.append(li);
  }

  const pending = plan.steps.filter((s) => s.status !== "done");
  // Unconfirmed hands-on steps show as "catch up" for 5 minutes, then count as done.
  const overdue = pending.filter((s) => s.kind === "active" && !s.system && s.end <= t && t < s.end + 5);
  const active = pending.filter((s) => s.kind === "active" && s.start <= t && t < s.end);
  const running = pending.filter((s) => s.kind === "passive" && s.start <= t && t < s.end);
  const upcoming = pending.filter((s) => s.start > t).sort((a, b) => a.start - b.start);
  const doNow = [...overdue, ...active];

  // NOW card
  if (doNow.length) {
    const s = doNow[0];
    doNowId = s.id;
    el.nowCard.classList.remove("is-waiting");
    el.nowLabel.textContent = overdue.includes(s) ? "Catch up" : "Right now";
    el.nowDish.textContent = s.dish;
    el.nowTitle.textContent = s.label;
    const more = doNow.length > 1 ? ` · then ${doNow[1].label.toLowerCase()}` : "";
    el.nowMeta.innerHTML = `About <b>${Math.max(1, s.end - s.start)} min</b> of hands-on work${escapeHtml(more)}`;
    el.doneBtn.hidden = false;
    el.lateBtn.hidden = false;
  } else if (upcoming.length) {
    const s = upcoming[0];
    doNowId = null;
    el.nowCard.classList.add("is-waiting");
    el.nowLabel.textContent = "Next up";
    el.nowDish.textContent = s.dish;
    el.nowTitle.textContent = s.label;
    el.nowMeta.innerHTML = `At <b>${fmtClock(plan.serveAtMs + s.start * 60000)}</b> · starts in <b>${fmtLeft(s.start - t)}</b>`;
    el.doneBtn.hidden = true;
    el.lateBtn.hidden = false;
  } else {
    doNowId = null;
    el.nowCard.classList.add("is-waiting");
    el.nowLabel.textContent = t >= 0 ? "Served" : "Almost there";
    el.nowDish.textContent = "";
    el.nowTitle.textContent = t >= 0 ? "Everything is ready. Enjoy!" : "Let everything finish";
    el.nowMeta.textContent = "";
    el.doneBtn.hidden = true;
    el.lateBtn.hidden = true;
  }

  // timers
  el.timers.innerHTML = "";
  if (!running.length) el.timers.innerHTML = `<li class="muted">No timers running</li>`;
  for (const s of running) {
    const li = document.createElement("li");
    li.className = "timer";
    const pct = Math.min(100, Math.max(0, ((t - s.start) / (s.end - s.start)) * 100));
    const what = s.system ? `Oven heating${s.temp ? ` to ${s.temp}` : ""}` : `${s.dish}${s.resource === "oven" ? " · oven" : s.resource === "burner" ? " · stove" : ""}`;
    li.innerHTML = `<span class="what"></span><span class="left">${fmtLeft(s.end - t)}</span><span class="bar"><i></i></span>`;
    (li.querySelector(".what") as HTMLElement).textContent = what;
    li.style.setProperty("--p", `${pct}%`);
    li.style.setProperty("--c", colorFor(s.dishId));
    el.timers.append(li);
  }

  // up next
  el.upnext.innerHTML = "";
  const nextItems = upcoming.slice(doNow.length ? 0 : 1, (doNow.length ? 0 : 1) + 3);
  if (!nextItems.length) el.upnext.innerHTML = `<li class="muted">That's everything</li>`;
  for (const s of nextItems) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="at">${fmtClock(plan.serveAtMs + s.start * 60000)}</span><span class="what"></span>`;
    const what = li.querySelector(".what") as HTMLElement;
    what.textContent = s.label;
    const dish = document.createElement("span");
    dish.className = "dish";
    dish.textContent = s.dish;
    what.append(dish);
    el.upnext.append(li);
  }

  renderLanes(plan, t);
}

function renderLanes(plan: NonNullable<Dinner["plan"]>, t: number) {
  const first = Math.min(...plan.steps.map((s) => s.start));
  // Long before cooking starts, show just the plan; once close, include "now".
  const lo = t < first - 20 ? first - 3 : Math.min(first, Math.floor(t)) - 2;
  const hi = Math.max(1, Math.ceil(t) + 1);
  const span = Math.max(1, hi - lo);
  const x = (m: number) => `${((m - lo) / span) * 100}%`;

  const order: string[] = [];
  for (const s of [...plan.steps].sort((a, b) => a.start - b.start)) if (!order.includes(s.dishId)) order.push(s.dishId);

  el.lanes.innerHTML = "";
  for (const id of order) {
    const steps = plan.steps.filter((s) => s.dishId === id);
    const lane = document.createElement("div");
    lane.className = "lane";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = steps[0].dish;
    const track = document.createElement("div");
    track.className = "track";
    for (const s of steps) {
      const b = document.createElement("div");
      b.className = `block ${s.kind}${s.status === "done" ? " done" : ""}${s.system ? " system" : ""}`;
      b.style.left = x(s.start);
      b.style.width = `calc(${x(s.end)} - ${x(s.start)})`;
      b.style.setProperty("--c", colorFor(s.dishId));
      b.title = `${fmtClock(plan.serveAtMs + s.start * 60000)}–${fmtClock(plan.serveAtMs + s.end * 60000)} · ${s.label}${s.temp ? ` · ${s.temp}` : ""}`;
      track.append(b);
    }
    lane.append(name, track);
    el.lanes.append(lane);
  }
  // now line spans every track
  const tracks = el.lanes.querySelectorAll<HTMLElement>(".track");
  tracks.forEach((tr) => {
    const line = document.createElement("div");
    line.className = "nowline";
    line.style.left = x(Math.min(Math.max(t, lo), hi));
    if (t < lo) line.style.opacity = "0";
    tr.append(line);
  });

  // axis ticks every 10 or 15 minutes, plus serve time
  el.axis.innerHTML = "";
  const step = span > 120 ? 30 : span > 60 ? 15 : 10;
  for (let m = Math.ceil(lo / step) * step; m <= 0; m += step) {
    const tick = document.createElement("span");
    tick.style.left = x(m);
    tick.textContent = m === 0 ? `🍽 ${fmtClock(plan.serveAtMs)}` : fmtClock(plan.serveAtMs + m * 60000);
    el.axis.append(tick);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function call(name: string, args: Record<string, unknown>, busy: HTMLButtonElement) {
  busy.disabled = true;
  try {
    const res = await app.callServerTool({ name, arguments: args });
    apply(res.structuredContent as Dinner);
  } catch (e) {
    setNote(`Couldn't reach Sous: ${(e as Error).message}`, true);
  } finally {
    busy.disabled = false;
  }
}

el.doneBtn.addEventListener("click", () => {
  if (doNowId) void call("mark_step_done", { step: doNowId }, el.doneBtn);
});
el.lateBtn.addEventListener("click", () => void call("running_late", { minutes: 5 }, el.lateBtn));

function onContext(ctx: McpUiHostContext) {
  // Optional, non-standard: a host that fast-forwards time for demos tells us the rate.
  const extra = ctx as Record<string, unknown>;
  const rate = Number(extra["sous/clockRate"]);
  if (Number.isFinite(rate) && rate > 0 && rate !== clock.rate) {
    syncClock(nowMs());
    clock.rate = rate;
  }
  const at = Number(extra["sous/clockNow"]);
  if (Number.isFinite(at) && at > 0) syncClock(at);
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    el.app.style.padding = `${top + 12}px ${right + 12}px ${bottom + 12}px ${left + 12}px`;
  }
}

// Device screens (landscape, limited height) get the fixed 1280×800 canvas, scaled to fit.
function fitCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const device = h > 0 && h < 1000 && w / h > 1.25;
  document.documentElement.classList.toggle("canvas", device);
  if (device) {
    const scale = Math.min(w / 1280, h / 800);
    el.app.style.setProperty("--scale", String(scale));
    el.app.style.setProperty("--dx", `${(w - 1280 * scale) / 2}px`);
    el.app.style.setProperty("--dy", `${(h - 800 * scale) / 2}px`);
  }
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

app.ontoolresult = (result) => apply(result.structuredContent as Dinner);
app.onhostcontextchanged = onContext;
app.onerror = (e) => console.error(e);
app.onteardown = async () => ({});

setInterval(render, 250);
// Re-sync with the server now and then (other devices may have marked steps done).
setInterval(() => {
  if (dinner?.plan && !document.hidden) {
    app
      .callServerTool({ name: "whats_next", arguments: {} })
      .then((r) => apply(r.structuredContent as Dinner))
      .catch(() => {});
  }
}, 60000);

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) onContext(ctx);
});
render();
