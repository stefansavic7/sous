// Builds the Echo Show view (single HTML file), the simulator and the server bundle.
import { build as viteBuild } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { build as esbuild } from "esbuild";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "server", "dist");
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1. MCP App view shown on Echo Show screens
await viteBuild({
  root: path.join(ROOT, "ui"),
  logLevel: "warn",
  plugins: [viteSingleFile()],
  build: { outDir: path.join(DIST, "ui"), emptyOutDir: true, rollupOptions: { input: path.join(ROOT, "ui", "timeline.html") } },
});

// 2. Alexa+ simulator (static site; runs the MCP server in the browser or connects to one)
if (existsSync(path.join(ROOT, "simulator", "index.html"))) {
  await viteBuild({
    root: path.join(ROOT, "simulator"),
    base: "./",
    logLevel: "warn",
    build: { outDir: path.join(DIST, "simulator"), emptyOutDir: true },
  });
}

// 3. Server bundle (dependencies stay in node_modules)
await esbuild({
  entryPoints: [path.join(ROOT, "server", "src", "main.ts")],
  outfile: path.join(DIST, "main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
console.log("Built server/dist (main.js, ui/timeline.html" + (existsSync(path.join(DIST, "simulator")) ? ", simulator/" : "") + ")");
