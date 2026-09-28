import { AppBridge, PostMessageTransport, RESOURCE_MIME_TYPE, getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, Client, Tool } from "@modelcontextprotocol/client";

const HOST_INFO = { name: "alexa-plus-simulator", version: "0.1.0" };

export interface DeviceOptions {
  /** Called when someone taps a control on the screen that calls a tool. */
  onScreenToolCall?: (name: string, args: Record<string, unknown>, result: CallToolResult) => void;
  clockRate: () => number;
  theme: () => "light" | "dark";
}

/**
 * The simulated Echo Show screen. Each tool call with a UI gets its own MCP App
 * view (as the MCP Apps spec expects); the new view fades in over the old one.
 */
export class EchoShowScreen {
  private readonly host: HTMLElement;
  private readonly client: Client;
  private readonly opts: DeviceOptions;
  private readonly tools = new Map<string, Tool>();
  private readonly htmlCache = new Map<string, string>();
  private current?: { iframe: HTMLIFrameElement; bridge: AppBridge };

  constructor(host: HTMLElement, client: Client, opts: DeviceOptions) {
    this.host = host;
    this.client = client;
    this.opts = opts;
  }

  async init(): Promise<void> {
    const { tools } = await this.client.listTools();
    for (const t of tools) this.tools.set(t.name, t);
  }

  hasUi(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    return Boolean(tool && getToolUiResourceUri(tool));
  }

  private async html(uri: string): Promise<string> {
    const cached = this.htmlCache.get(uri);
    if (cached) return cached;
    const res = await this.client.readResource({ uri });
    const content = res.contents[0] as { mimeType?: string; text?: string; blob?: string };
    if (content.mimeType !== RESOURCE_MIME_TYPE) throw new Error(`Unexpected UI resource type ${content.mimeType}`);
    const html = content.text ?? (content.blob ? atob(content.blob) : "");
    this.htmlCache.set(uri, html);
    return html;
  }

  /** Shows the tool's view with this call's input and result. */
  async show(toolName: string, args: Record<string, unknown>, result: CallToolResult): Promise<void> {
    const tool = this.tools.get(toolName);
    const uri = tool ? getToolUiResourceUri(tool) : undefined;
    if (!tool || !uri) return;
    const html = await this.html(uri);

    const iframe = document.createElement("iframe");
    iframe.className = "view entering";
    iframe.title = "Sous on Echo Show";
    // No allow-same-origin: the view runs in an opaque origin and can't touch this page.
    iframe.setAttribute("sandbox", "allow-scripts allow-forms");
    this.host.append(iframe);

    const rect = this.host.getBoundingClientRect();
    const bridge = new AppBridge(
      this.client,
      HOST_INFO,
      { openLinks: {}, serverTools: this.client.getServerCapabilities()?.tools, serverResources: this.client.getServerCapabilities()?.resources },
      {
        hostContext: {
          theme: this.opts.theme(),
          platform: "desktop",
          locale: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          displayMode: "fullscreen",
          availableDisplayModes: ["fullscreen"],
          containerDimensions: { width: Math.round(rect.width), height: Math.round(rect.height) },
          deviceCapabilities: { touch: true, hover: false },
          toolInfo: { tool },
          "sous/clockRate": this.opts.clockRate(),
        },
      },
    );
    bridge.oncalltool = async (params) => {
      const res = (await this.client.callTool(params)) as CallToolResult;
      this.opts.onScreenToolCall?.(params.name, (params.arguments ?? {}) as Record<string, unknown>, res);
      return res;
    };
    bridge.onopenlink = async ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return {};
    };
    const initialized = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
    iframe.srcdoc = html;
    await Promise.race([initialized, new Promise((r) => setTimeout(r, 4000))]);
    await bridge.sendToolInput({ arguments: args });
    await bridge.sendToolResult(result);

    const previous = this.current;
    this.current = { iframe, bridge };
    requestAnimationFrame(() => iframe.classList.remove("entering"));
    if (previous) {
      setTimeout(async () => {
        await previous.bridge.teardownResource({}).catch(() => {});
        await previous.bridge.close().catch(() => {});
        previous.iframe.remove();
      }, 450);
    }
  }

  /** Pushes demo clock changes (speed or a jump) to the visible view. */
  setClock(rate: number, now: number): void {
    void this.current?.bridge.sendHostContextChange({ "sous/clockRate": rate, "sous/clockNow": now } as never);
  }

  setTheme(theme: "light" | "dark"): void {
    void this.current?.bridge.sendHostContextChange({ theme });
  }
}
