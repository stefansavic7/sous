# Product feedback

## Tools and SDKs used

| Tool | Used for |
| --- | --- |
| MCP (spec 2025-11-25), Streamable HTTP | The Alexa+ integration: tools, resources, prompts, elicitation, sampling. |
| `@modelcontextprotocol/server`, `client`, `node`, `express` (TypeScript SDK v2) | Server, stateful HTTP sessions, end-to-end tests, and the simulator's client. |
| `@modelcontextprotocol/ext-apps` (MCP Apps) | The Echo Show view (`ui://sous/timeline.html`) and the simulator host (`AppBridge`). |
| MCP Inspector | Manual testing of tools and resources. |

## What worked well

- MCP is a good fit for Alexa+: tools with `outputSchema` let the view and the voice response come from the same result (`structuredContent` for the screen, `speech` for the voice).
- MCP Apps made the Echo Show screen easy: one HTML bundle, theme from the host, and view-initiated tool calls for on-screen buttons.
- The v2 client made end-to-end tests over real Streamable HTTP short and reliable, including elicitation and sampling handlers.

## What needs improvement

- A device-less Alexa+ test console, and access for developers outside launch countries.
- A published list of the MCP capabilities Alexa+ supports and the Echo Show view environment (sizes, input, fonts).
- A persistent view mode for ambient displays.
- Consistent SDK versions across the Alexa+ resources (v1 vs v2 split packages).

## Onboarding

Getting an MCP server running took minutes. Understanding how it would behave inside Alexa+ was the slow part, because there is no way to run it there without Alexa+ access. Building a simulator took most of the integration time.

## Would I build with these again?

Yes. The server works unchanged with any MCP host, and the same view renders in other MCP Apps hosts. I'd build the next Alexa+ skill the same way once a test console exists.
