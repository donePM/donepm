import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT } from "./protocol.js";
import { runShim } from "./shim.js";

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** A stand-in daemon: records what arrives, answers the hello with `welcome`. */
async function fakeDaemon(welcome: string): Promise<{ path: string; received: () => string; conn: () => Socket }> {
  const path = join(await mkdtemp(join(tmpdir(), "dp-shim-")), "s.sock");
  let data = "";
  let socket: Socket | undefined;
  server = createServer((s) => {
    socket = s;
    s.once("data", () => s.write(welcome));
    s.on("data", (c) => (data += c.toString()));
  });
  await new Promise<void>((r) => server!.listen(path, r));
  return { path, received: () => data, conn: () => socket! };
}

function io(env: NodeJS.ProcessEnv) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (c) => (out += c.toString()));
  stderr.on("data", (c) => (err += c.toString()));
  return { io: { env, stdin, stdout, stderr }, stdin, out: () => out, err: () => err };
}

describe("runShim", () => {
  it("exits 64 without socket and token", async () => {
    const t = io({});
    expect(await runShim(t.io)).toBe(EXIT.unconfigured);
    expect(t.err()).toMatch(/DONEPM_SOCKET and DONEPM_TOKEN/);
  });

  it("exits 69 when no daemon listens", async () => {
    const t = io({ DONEPM_SOCKET: join(tmpdir(), "dp-none.sock"), DONEPM_TOKEN: "t" });
    expect(await runShim(t.io)).toBe(EXIT.unreachable);
    expect(t.err()).toMatch(/cannot reach the donePM daemon/);
  });

  it("exits 70 when refused, with the daemon's reason", async () => {
    const d = await fakeDaemon('{"ok":false,"reason":"unknown session token"}\n');
    const t = io({ DONEPM_SOCKET: d.path, DONEPM_TOKEN: "t" });
    expect(await runShim(t.io)).toBe(EXIT.refused);
    expect(t.err()).toMatch(/refused: unknown session token/);
  });

  it("sends the hello first, then relays both ways, and exits 0 when stdin ends", async () => {
    // A reply arriving in the same chunk as the welcome must not be lost.
    const d = await fakeDaemon('{"ok":true}\n{"id":0}\n');
    const t = io({ DONEPM_SOCKET: d.path, DONEPM_TOKEN: "tok" });
    const done = runShim(t.io);
    await vi.waitFor(() => expect(t.out()).toBe('{"id":0}\n'));
    t.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    await vi.waitFor(() => expect(d.received()).toContain('"method":"ping"'));
    expect(d.received().split("\n")[0]).toBe('{"bridge":1,"token":"tok"}');
    d.conn().write('{"id":1}\n');
    await vi.waitFor(() => expect(t.out()).toBe('{"id":0}\n{"id":1}\n'));
    d.conn().on("end", () => d.conn().end());
    t.stdin.end();
    expect(await done).toBe(0);
  });

  it("reads the token from DONEPM_TOKEN_FILE when the env holds only its path (#137)", async () => {
    const d = await fakeDaemon('{"ok":true}\n');
    const file = join(await mkdtemp(join(tmpdir(), "dp-tok-")), "token");
    await writeFile(file, "filetok\n", { mode: 0o600 });
    const t = io({ DONEPM_SOCKET: d.path, DONEPM_TOKEN_FILE: file });
    const done = runShim(t.io);
    await vi.waitFor(() => expect(d.received().split("\n")[0]).toBe('{"bridge":1,"token":"filetok"}'));
    d.conn().destroy();
    await done;
  });

  it("exits 64 when the token file cannot be read", async () => {
    const t = io({ DONEPM_SOCKET: join(tmpdir(), "dp-none.sock"), DONEPM_TOKEN_FILE: join(tmpdir(), "dp-no-such-token") });
    expect(await runShim(t.io)).toBe(EXIT.unconfigured);
  });

  it("exits 69 when the daemon goes away mid-session", async () => {
    const d = await fakeDaemon('{"ok":true}\n');
    const t = io({ DONEPM_SOCKET: d.path, DONEPM_TOKEN: "tok" });
    const done = runShim(t.io);
    t.stdin.write("{}\n");
    await vi.waitFor(() => expect(d.received()).toContain("{}"));
    d.conn().destroy();
    expect(await done).toBe(EXIT.unreachable);
    expect(t.err()).toMatch(/went away/);
  });
});
