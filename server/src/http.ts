import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { isInitializeRequest } from "@modelcontextprotocol/server";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { createSousServer, VERSION } from "./sous.ts";
import type { SousStore } from "./store.ts";

export interface HttpOptions {
  store: SousStore;
  timelineHtml: () => string | Promise<string>;
  host?: string;
  /** When set, /mcp requires `Authorization: Bearer <token>`. */
  token?: string;
  /** Folder with the built Alexa+ simulator, served at `/`. */
  staticDir?: string;
  now?: () => number;
}

/**
 * Express app with a stateful Streamable HTTP endpoint at /mcp: one MCP server and
 * transport per session, so server-to-client requests (elicitation, sampling) work.
 */
export function createHttpApp(opts: HttpOptions): { app: Express; sessions: Map<string, NodeStreamableHTTPServerTransport> } {
  const app = createMcpExpressApp({ host: opts.host ?? "127.0.0.1" });
  app.use(
    cors({
      exposedHeaders: ["Mcp-Session-Id"],
      allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"],
    }),
  );
  const sessions = new Map<string, NodeStreamableHTTPServerTransport>();

  const authorized = (req: Request, res: Response): boolean => {
    if (!opts.token || req.headers.authorization === `Bearer ${opts.token}`) return true;
    res.status(401).set("WWW-Authenticate", "Bearer").json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    return false;
  };

  const route = async (req: Request, res: Response) => {
    if (!authorized(req, res)) return;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await createSousServer({ store: opts.store, timelineHtml: opts.timelineHtml, now: opts.now }).connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      if (sessionId) {
        res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
        return;
      }
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: send initialize first" }, id: null });
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  };
  app.post("/mcp", route);
  app.get("/mcp", route);
  app.delete("/mcp", route);
  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "sous", version: VERSION, sessions: sessions.size });
  });
  if (opts.staticDir) app.use("/", express.static(opts.staticDir));
  return { app, sessions };
}
