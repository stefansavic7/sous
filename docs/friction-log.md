# Friction log

Real problems hit while building Sous for the Alexa+ track, in the order they happened.

## 1. No way to test an Alexa+ MCP skill from outside the launch countries

- **Task:** Try the Sous MCP server with Alexa+ on an Echo Show.
- **Steps:** Read the Alexa+ track resources (MCP Apps docs, Streamable HTTP transport spec). Looked for an Alexa+ developer console, test simulator or device-less test path.
- **Expected:** A web test console for Alexa+ MCP skills, like the Alexa Skills Kit test simulator, usable from any country.
- **Actual:** The resources link to the generic MCP docs only. Alexa+ is not offered where I live (Bosnia and Herzegovina), so there was no way to see how Alexa+ calls the tools or renders the MCP App.
- **Severity:** High
- **Workaround:** Built a simulator host (smart-display frame, AppBridge, speech in/out) and tested with the official MCP client and MCP Inspector.
- **Suggestion:** Ship a browser-based Alexa+ MCP test console that connects to a developer's `/mcp` URL, shows the model's tool calls, and renders MCP Apps at Echo Show sizes.

## 2. Unclear which MCP features Alexa+ supports

- **Task:** Decide whether to rely on elicitation (ask for the dinner time) and sampling (draft an unknown recipe).
- **Steps:** Searched the track resources for Alexa+ client capabilities.
- **Expected:** A capability table: protocol versions, elicitation (form/URL), sampling, MCP Apps, display sizes, proactive notifications.
- **Actual:** Not documented, so every feature needs a fallback.
- **Severity:** Medium
- **Workaround:** Checked `getClientCapabilities()` at runtime; without elicitation Sous plans for "as soon as possible", without sampling it asks the user to add the recipe.
- **Suggestion:** Publish Alexa+'s `initialize` capabilities and the Echo Show `hostContext` (viewport, touch, fonts, safe areas).

## 3. MCP Apps 2.x silently needs the new split SDK packages

- **Task:** Add a UI resource to the server with `@modelcontextprotocol/ext-apps`.
- **Steps:** Installed `@modelcontextprotocol/sdk` (the package most docs and examples use) plus `ext-apps@2`.
- **Expected:** `registerAppTool` works with the SDK most people have.
- **Actual:** `ext-apps` 2.x targets the v2 split packages (`@modelcontextprotocol/server`, `client`, `node`, `express`); mixing it with the v1 SDK gives type errors.
- **Severity:** Medium
- **Workaround:** Moved the whole server to the v2 packages.
- **Suggestion:** Alexa+ starter repo pinned to known-good versions of the SDK and `ext-apps`.

## 4. The default HTTP handler can't do elicitation for 2025-11-25 clients

- **Task:** Ask "What time would you like to eat?" with elicitation over Streamable HTTP.
- **Steps:** Started from `createMcpHandler` (stateless) as in the serving guide, then called `ctx.mcpReq.elicitInput`.
- **Expected:** Elicitation works with the documented default setup.
- **Actual:** Push-style elicitation/sampling need a stateful session (the client's answer arrives as a new POST that must reach the same server instance). The typings mark `elicitInput` as throwing on 2026-07-28-era requests. The sessions guide is a separate page.
- **Severity:** Medium
- **Workaround:** Hand-wired sessions: one `NodeStreamableHTTPServerTransport` and `McpServer` per `Mcp-Session-Id`.
- **Suggestion:** State in the Alexa+ docs which protocol revision Alexa+ negotiates and show a stateful example.

## 5. `structuredContent` validates in Node but fails in the browser

- **Task:** Run the same server in the browser for the simulator.
- **Steps:** Returned DTOs with optional fields left as `undefined`.
- **Expected:** Same validation result in Node and in the browser.
- **Actual:** Node (AJV) accepted it; the browser validator threw `Instances of "undefined" type are not supported`.
- **Severity:** Low
- **Workaround:** JSON round-trip before returning (`JSON.parse(JSON.stringify(x))`).
- **Suggestion:** Normalize `undefined` identically in every validator, or document it.

## 6. `registerAppTool` doesn't accept `icons`

- **Task:** Give app tools icons (a 2025-11-25 feature) so they look right in tool lists.
- **Actual:** `McpServer.registerTool` accepts `icons`, but `registerAppTool`'s config type doesn't, so TypeScript rejects it.
- **Severity:** Low
- **Workaround:** Spread an untyped object into the config.
- **Suggestion:** Extend `McpUiAppToolConfig` with the full tool config.

## 7. MCP Apps assumes one view per tool call; a kitchen display wants one persistent screen

- **Task:** Keep a single dinner dashboard on the Echo Show while the cook talks to Alexa for an hour.
- **Expected:** A way to update an existing view with a new tool result.
- **Actual:** The host API says tool input is sent exactly once per view, so each spoken request mounts a new view.
- **Severity:** Medium (for ambient displays)
- **Workaround:** Each call mounts a fresh view with a cross-fade; the view refreshes itself through `callServerTool` in between.
- **Suggestion:** A "pinned/ambient view" mode for Echo Show-style devices that receives later results of the same tool family.
