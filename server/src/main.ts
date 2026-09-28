import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createHttpApp } from "./http.ts";
import { createSousServer, VERSION } from "./sous.ts";
import { SousStore } from "./store.ts";
import { filePersistence } from "./persist.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Works from source (server/src) and from the bundle (server/dist).
const ROOT = path.resolve(HERE, "..", "..");
const DIST = path.join(ROOT, "server", "dist");
const UI_FILE = [path.join(HERE, "ui", "timeline.html"), path.join(DIST, "ui", "timeline.html")].find((f) => fs.existsSync(f));
const SIM_DIR = [path.join(HERE, "simulator"), path.join(DIST, "simulator")].find((d) => fs.existsSync(path.join(d, "index.html")));

function timelineHtml(): string {
  if (!UI_FILE) return "<!doctype html><p>Timeline view not built yet. Run <code>npm run build</code>.</p>";
  return fs.readFileSync(UI_FILE, "utf8");
}

async function makeStore(): Promise<SousStore> {
  const dataFile = process.env.SOUS_DATA ?? path.join(ROOT, "data", "sous.json");
  const persistence = process.env.SOUS_DATA === "memory" ? undefined : await filePersistence(dataFile);
  const units = process.env.SOUS_UNITS === "C" || process.env.SOUS_UNITS === "F" ? process.env.SOUS_UNITS : undefined;
  return new SousStore({ timeZone: process.env.SOUS_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone, units }, persistence);
}

async function startHttp(): Promise<void> {
  const store = await makeStore();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "127.0.0.1";
  const token = process.env.SOUS_TOKEN;
  const { app, sessions } = createHttpApp({ store, timelineHtml, host, token, staticDir: SIM_DIR });
  const httpServer = app.listen(port, host, () => {
    console.log(`Sous MCP server v${VERSION}`);
    console.log(`  MCP endpoint (Streamable HTTP): http://${host}:${port}/mcp`);
    if (SIM_DIR) console.log(`  Alexa+ simulator:               http://${host}:${port}/`);
    if (token) console.log("  Requires Authorization: Bearer $SOUS_TOKEN");
  });
  const shutdown = async () => {
    for (const t of sessions.values()) await t.close().catch(() => {});
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdio(): Promise<void> {
  const store = await makeStore();
  await createSousServer({ store, timelineHtml }).connect(new StdioServerTransport());
}

(process.argv.includes("--stdio") ? startStdio() : startHttp()).catch((e) => {
  console.error(e);
  process.exit(1);
});
