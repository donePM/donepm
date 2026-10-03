import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

export type PushType = "item.updated" | "event.appended" | "transcript.appended" | "stream.delta" | "status.changed";

/** Pushes `{ type, payload }` to every connected UI on `/ws` (spec 11). Server to client only. */
export class Hub {
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(private readonly isAllowed: (req: IncomingMessage) => boolean) {}

  attach(server: Server): void {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (new URL(req.url ?? "/", "http://x").pathname !== "/ws" || !this.isAllowed(req)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws: WebSocket) => this.wss.emit("connection", ws, req));
    });
  }

  push(type: PushType, payload: unknown): void {
    const msg = JSON.stringify({ type, payload });
    for (const client of this.wss.clients) if (client.readyState === client.OPEN) client.send(msg);
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  close(): void {
    for (const client of this.wss.clients) client.terminate();
    this.wss.close();
  }
}
