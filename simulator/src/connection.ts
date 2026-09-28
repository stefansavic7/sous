import { Client, InMemoryTransport, StreamableHTTPClientTransport, type Transport } from "@modelcontextprotocol/client";
import { createSousServer } from "../../server/src/sous.ts";
import { SousStore } from "../../server/src/store.ts";
import timelineHtml from "../../server/dist/ui/timeline.html?raw";

/** A clock the demo can fast-forward. The in-browser Sous server reads time from it. */
export class SimClock {
  private base = Date.now();
  private realAt = Date.now();
  private _rate = 1;
  now = (): number => this.base + (Date.now() - this.realAt) * this._rate;
  get rate(): number {
    return this._rate;
  }
  setRate(rate: number): void {
    this.base = this.now();
    this.realAt = Date.now();
    this._rate = rate;
  }
  jump(minutes: number): void {
    this.base = this.now() + minutes * 60000;
    this.realAt = Date.now();
  }
  /** Starts the demo clock at a wall-clock time today, e.g. "18:05" (for demos at dinner time). */
  startAt(hhmm: string): void {
    const m = hhmm.match(/^(\d{1,2}):?(\d{2})$/);
    if (!m) return;
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    this.base = d.getTime();
    this.realAt = Date.now();
  }
}

export type Direction = "out" | "in";
export type TrafficListener = (direction: Direction, message: unknown) => void;

/** Lets the simulator show every JSON-RPC message that crosses the wire. */
function tap<T extends Transport>(transport: T, listener: TrafficListener): T {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    listener("out", message);
    return send(message, options);
  };
  let handler: Transport["onmessage"];
  const wrapped: Transport["onmessage"] = (message, extra) => {
    listener("in", message);
    handler?.(message, extra);
  };
  Object.defineProperty(transport, "onmessage", {
    configurable: true,
    get: () => (handler ? wrapped : undefined),
    set: (h: Transport["onmessage"]) => {
      handler = h;
    },
  });
  return transport;
}

export type ElicitationHandler = (message: string, schema: unknown) => Promise<Record<string, string> | null>;

export interface Connection {
  client: Client;
  label: string;
  timelineHtml?: string;
  simulatedClock: boolean;
  close(): Promise<void>;
}

const CLIENT_INFO = { name: "alexa-plus-simulator", title: "Alexa+ simulator for Sous", version: "0.1.0" };

function makeClient(onElicit: ElicitationHandler): Client {
  const client = new Client(CLIENT_INFO, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler("elicitation/create", async (request) => {
    const params = request.params as { message: string; requestedSchema?: unknown };
    const content = await onElicit(params.message, params.requestedSchema);
    return content ? { action: "accept", content } : { action: "decline" };
  });
  return client;
}

/** Runs the real Sous MCP server inside this page and connects to it over an in-memory transport. */
export async function connectInBrowser(clock: SimClock, onTraffic: TrafficListener, onElicit: ElicitationHandler): Promise<Connection> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const units = /^en-(US|LR|MM)$/i.test(navigator.language) || tz.startsWith("America/") ? "F" : "C";
  const store = new SousStore({ timeZone: tz, units });
  const server = createSousServer({ store, now: clock.now, timelineHtml: () => timelineHtml });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = makeClient(onElicit);
  await client.connect(tap(clientSide, onTraffic));
  return {
    client,
    label: "In-browser Sous server",
    timelineHtml,
    simulatedClock: true,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Connects to a self-hosted Sous server over Streamable HTTP. */
export async function connectRemote(url: string, token: string | undefined, onTraffic: TrafficListener, onElicit: ElicitationHandler): Promise<Connection> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = makeClient(onElicit);
  await client.connect(tap(transport, onTraffic));
  return { client, label: url, simulatedClock: false, close: () => client.close() };
}
