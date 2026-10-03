import { connect as netConnect, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { BRIDGE_PROTOCOL, EXIT, type Hello, type Welcome } from "./protocol.js";

export interface ShimIo {
  env: NodeJS.ProcessEnv;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  connect?: (path: string) => Socket;
}

/**
 * `donepm-bridge`: relays stdio lines to the daemon's unix socket. Sends one hello line with the
 * session token first and waits for the welcome. No MCP logic: everything is answered in the
 * daemon, so the shim never skews against it. Resolves with the exit status.
 */
export function runShim(io: ShimIo): Promise<number> {
  const socketPath = io.env.DONEPM_SOCKET;
  const token = io.env.DONEPM_TOKEN;
  if (!socketPath || !token) {
    io.stderr.write("donepm-bridge: DONEPM_SOCKET and DONEPM_TOKEN must be set (started by the donePM daemon)\n");
    return Promise.resolve(EXIT.unconfigured);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number, message?: string) => {
      if (settled) return;
      settled = true;
      if (message) io.stderr.write(`donepm-bridge: ${message}\n`);
      io.stdin.unpipe(socket);
      socket.destroy();
      resolve(code);
    };

    const socket = (io.connect ?? netConnect)(socketPath);
    let welcomed = false;
    let stdinEnded = false;
    let pending = "";

    socket.on("connect", () => {
      const hello: Hello = { bridge: BRIDGE_PROTOCOL, token };
      socket.write(`${JSON.stringify(hello)}\n`);
    });
    socket.on("error", (e) => finish(EXIT.unreachable, welcomed ? `lost the daemon: ${e.message}` : `cannot reach the donePM daemon at ${socketPath}: ${e.message}`));
    socket.on("close", () => {
      if (!welcomed) finish(EXIT.unreachable, "the donePM daemon closed the connection during the handshake");
      else if (stdinEnded) finish(0);
      else finish(EXIT.unreachable, "the donePM daemon went away");
    });

    socket.on("data", (chunk: Buffer) => {
      if (welcomed) {
        io.stdout.write(chunk);
        return;
      }
      pending += chunk.toString("utf8");
      const nl = pending.indexOf("\n");
      if (nl === -1) return;
      const first = pending.slice(0, nl);
      const rest = pending.slice(nl + 1);
      pending = "";
      let welcome: Welcome;
      try {
        welcome = JSON.parse(first) as Welcome;
      } catch {
        return finish(EXIT.refused, "the daemon answered the handshake with something unreadable");
      }
      if (!welcome.ok) return finish(EXIT.refused, `refused: ${welcome.reason}`);
      welcomed = true;
      if (rest) io.stdout.write(rest);
      io.stdin.on("end", () => {
        stdinEnded = true;
        socket.end();
      });
      io.stdin.pipe(socket, { end: false });
    });
  });
}
