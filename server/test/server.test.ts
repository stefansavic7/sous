import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/http.ts";
import { SousStore } from "../src/store.ts";
import { TIMELINE_URI } from "../src/sous.ts";

// A fixed "now": 5:00 PM in New York on 1 Oct 2026.
let clockNow = Date.UTC(2026, 9, 1, 21, 0);
const now = () => clockNow;

let http: Server;
let url: URL;

before(async () => {
  const store = new SousStore({ timeZone: "America/New_York", units: "F" });
  const { app } = createHttpApp({ store, timelineHtml: () => "<!doctype html><title>timeline</title>", now });
  await new Promise<void>((resolve) => {
    http = app.listen(0, "127.0.0.1", () => resolve());
  });
  url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
});

after(() => new Promise<void>((resolve) => http.close(() => resolve())));

async function connect(capabilities: Record<string, unknown> = {}) {
  const client = new Client({ name: "sous-test", version: "1.0.0" }, { capabilities });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
  return { client, transport };
}

type Dinner = {
  speech: string;
  plan: null | { serveAt: string; steps: Array<{ id: string; label: string; status: string; start: number }>; dishes: Array<{ name: string }> };
  now: null | { doNow: string[]; next: Array<{ id: string }> };
};

test("speaks MCP 2025-11-25 over Streamable HTTP and lists the tools", async () => {
  const { client, transport } = await connect();
  assert.ok(transport.sessionId, "stateful session id issued");
  assert.equal(client.getServerVersion()?.name, "sous");
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const n of ["plan_dinner", "whats_next", "mark_step_done", "running_late", "find_recipes", "get_recipe", "add_recipe", "set_kitchen"]) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
  const plan = tools.find((t) => t.name === "plan_dinner")!;
  assert.equal((plan._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri, TIMELINE_URI);
  assert.ok(plan.outputSchema, "structured output schema");
  assert.ok(plan.icons?.length, "tool icon");
  await client.close();
});

test("plans, walks through and re-plans a dinner", async () => {
  const { client } = await connect();
  const planned = await client.callTool({ name: "plan_dinner", arguments: { dishes: ["salmon", "rice", "broccoli"], serve_at: "7pm" } });
  assert.ok(!planned.isError);
  const d = planned.structuredContent as Dinner;
  assert.match(d.speech, /Dinner is at 7:00 PM/);
  assert.equal(d.plan!.dishes.length, 3);
  assert.equal(d.plan!.serveAt, new Date(Date.UTC(2026, 9, 1, 23, 0)).toISOString());
  assert.match(d.speech, /400°F/, "Fahrenheit for a US household");

  // Jump to the first step and ask what's next.
  const first = d.plan!.steps.filter((s) => !s.label.startsWith("Preheat"))[0];
  clockNow = Date.UTC(2026, 9, 1, 23, 0) + first.start * 60000;
  const next = (await client.callTool({ name: "whats_next", arguments: {} })).structuredContent as Dinner;
  assert.match(next.speech, /Right now|Next/);

  const done = (await client.callTool({ name: "mark_step_done", arguments: { step: "rinsed the rice" } })).structuredContent as Dinner;
  assert.match(done.speech, /rice/i);
  assert.ok(done.plan!.steps.some((s) => s.status === "done"));

  const late = (await client.callTool({ name: "running_late", arguments: { minutes: 10 } })).structuredContent as Dinner;
  assert.match(late.speech, /(still eat at|best I can do|dinner moves)/i);
  await client.close();
});

test("asks for the dinner time with elicitation when it's missing", async () => {
  clockNow = Date.UTC(2026, 9, 1, 21, 0);
  const { client } = await connect({ elicitation: { form: {} } });
  let asked = "";
  client.setRequestHandler("elicitation/create", async (request) => {
    asked = request.params.message;
    return { action: "accept", content: { serve_at: "7:30pm" } };
  });
  const r = (await client.callTool({ name: "plan_dinner", arguments: { dishes: ["chicken", "roast potatoes"] } })).structuredContent as Dinner;
  assert.match(asked, /What time/);
  assert.match(r.speech, /7:30 PM/);
  await client.close();
});

test("without a time and without elicitation, plans for as soon as possible", async () => {
  clockNow = Date.UTC(2026, 9, 1, 21, 0);
  const { client } = await connect();
  const r = (await client.callTool({ name: "plan_dinner", arguments: { dishes: ["spaghetti"] } })).structuredContent as Dinner;
  assert.match(r.speech, /As soon as possible/);
  assert.ok(r.plan);
  await client.close();
});

test("drafts an unknown dish with sampling when the host allows it", async () => {
  const { client } = await connect({ sampling: {} });
  client.setRequestHandler("sampling/createMessage", async () => ({
    role: "assistant",
    model: "test-model",
    content: {
      type: "text",
      text: "1. Preheat the oven to 425°F.\n2. Toss the cauliflower with curry powder and oil, 5 minutes.\n3. Roast for 25 minutes.",
    },
  }));
  const r = (await client.callTool({ name: "plan_dinner", arguments: { dishes: ["curry cauliflower", "rice"], serve_at: "8pm" } }))
    .structuredContent as Dinner;
  assert.ok(r.plan!.dishes.some((x) => /cauliflower/i.test(x.name)));
  await client.close();
});

test("teaches, finds and reads recipes", async () => {
  const { client } = await connect();
  const added = await client.callTool({
    name: "add_recipe",
    arguments: { text: "Grandma's stuffed peppers\nPreheat the oven to 375F.\nStuff the peppers with rice and beef.\nBake for 45 minutes." },
  });
  assert.match((added.content as Array<{ text: string }>)[0].text, /Saved Grandma's stuffed peppers/);
  const found = await client.callTool({ name: "find_recipes", arguments: { query: "peppers" } });
  assert.match((found.content as Array<{ text: string }>)[0].text, /stuffed peppers/);
  const read = await client.callTool({ name: "get_recipe", arguments: { recipe: "salmon" } });
  assert.match((read.content as Array<{ text: string }>)[0].text, /Lemon garlic salmon/);
  await client.close();
});

test("serves the Echo Show view, recipe resources and a prompt", async () => {
  const { client } = await connect();
  const ui = await client.readResource({ uri: TIMELINE_URI });
  assert.equal(ui.contents[0].mimeType, "text/html;profile=mcp-app");
  const templates = await client.listResourceTemplates();
  assert.ok(templates.resourceTemplates.some((t) => t.uriTemplate === "sous://recipes/{id}"));
  const recipe = await client.readResource({ uri: "sous://recipes/white-rice" });
  assert.match((recipe.contents[0] as { text: string }).text, /Fluffy white rice/);
  const prompt = await client.getPrompt({ name: "plan_dinner_party", arguments: { dishes: "steak, mashed potatoes", time: "at 7" } });
  assert.match((prompt.messages[0].content as { text: string }).text, /steak, mashed potatoes/);
  await client.close();
});

test("rejects requests without the bearer token when one is configured", async () => {
  const store = new SousStore({ timeZone: "UTC" });
  const { app } = createHttpApp({ store, timelineHtml: () => "", token: "s3cret" });
  const srv: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (srv.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "1" } } }),
  });
  assert.equal(res.status, 401);
  await new Promise<void>((resolve) => srv.close(() => resolve()));
});
