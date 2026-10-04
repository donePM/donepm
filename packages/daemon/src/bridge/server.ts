import { chmodSync, rmSync } from "node:fs";
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Log } from "../log.js";
import { BRIDGE_PROTOCOL, type Hello, type Welcome } from "./protocol.js";
import type { BridgeSession, BridgeSessions } from "./sessions.js";
import { callTool, listTools, type ToolDeps } from "./tools.js";

export interface BridgeServerDeps extends ToolDeps {
  sessions: BridgeSessions;
  log: Log;
  version: string;
}

/**
 * The MCP server behind `donepm-bridge` (spec 10): a unix socket, one handshake line per
 * connection, then MCP over newline-delimited JSON-RPC. `initialize`, `tools/list` and
 * `tools/call` are all answered here.
 */
export async function listenBridge(deps: BridgeServerDeps, socketPath: string): Promise<{ close: () => Promise<void> }> {
  rmSync(socketPath, { force: true });
  const open = new Set<Socket>();
  const server = createServer((socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    handshake(deps, socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(socketPath, 0o600);
  return {
    close: () => {
      for (const s of open) s.destroy();
      return closeServer(server, socketPath);
    },
  };
}

function handshake(deps: BridgeServerDeps, socket: Socket): void {
  let pending = "";
  const onData = (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const nl = pending.indexOf("\n");
    if (nl === -1) return;
    socket.off("data", onData);
    const rest = Buffer.from(pending.slice(nl + 1), "utf8");
    const answer = check(deps, pending.slice(0, nl));
    pending = "";
    if (!answer.ok) {
      socket.end(`${JSON.stringify({ ok: false, reason: answer.reason } satisfies Welcome)}\n`);
      return;
    }
    socket.write(`${JSON.stringify({ ok: true } satisfies Welcome)}\n`);
    void serve(deps, answer.session, socket, rest);
  };
  socket.on("data", onData);
  socket.on("error", (e) => deps.log.warn({ err: e }, "bridge connection error"));
}

function check(deps: BridgeServerDeps, line: string): { ok: true; session: BridgeSession } | { ok: false; reason: string } {
  let hello: Partial<Hello>;
  try {
    hello = JSON.parse(line) as Partial<Hello>;
  } catch {
    return { ok: false, reason: "the hello line is not JSON" };
  }
  if (hello.bridge !== BRIDGE_PROTOCOL) {
    return { ok: false, reason: `bridge protocol ${String(hello.bridge)} does not match the daemon's ${BRIDGE_PROTOCOL}; restart the agent` };
  }
  const session = typeof hello.token === "string" ? deps.sessions.get(hello.token) : undefined;
  if (!session) return { ok: false, reason: "unknown session token; the agent session has ended or the daemon restarted" };
  return { ok: true, session };
}

async function serve(deps: BridgeServerDeps, session: BridgeSession, socket: Socket, rest: Buffer): Promise<void> {
  const mcp = new Server({ name: "donepm", version: deps.version }, { capabilities: { tools: {} } });
  mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listTools(session) }));
  mcp.setRequestHandler(CallToolRequestSchema, (req) => callTool(deps, session, req.params.name, req.params.arguments));
  const transport = new SocketTransport(socket, rest);
  transport.onerror = (e) => deps.log.warn({ err: e, itemId: session.itemId }, "bridge message error");
  await mcp.connect(transport);
}

/** MCP transport over one already-handshaken socket: newline-delimited JSON-RPC both ways. */
export class SocketTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();

  constructor(
    private readonly socket: Socket,
    /** Bytes that arrived with the handshake line. */
    private readonly initial: Buffer = Buffer.alloc(0),
  ) {}

  async start(): Promise<void> {
    this.socket.on("data", (chunk: Buffer) => this.receive(chunk));
    this.socket.on("close", () => this.onclose?.());
    if (this.initial.length > 0) this.receive(this.initial);
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.destroyed) return resolve();
      this.socket.write(serializeMessage(message), () => resolve());
    });
  }

  async close(): Promise<void> {
    this.socket.end();
  }

  private receive(chunk: Buffer): void {
    try {
      this.buffer.append(chunk);
    } catch (e) {
      this.onerror?.(e as Error);
      return;
    }
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.buffer.readMessage();
      } catch (e) {
        // One bad line must not end the session.
        this.onerror?.(e as Error);
        continue;
      }
      if (message === null) return;
      this.onmessage?.(message);
    }
  }
}

function closeServer(server: NetServer, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      rmSync(socketPath, { force: true });
      resolve();
    });
  });
}
