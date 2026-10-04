import { mkdtemp } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, describe, expect, it } from "vitest";
import { silentLog } from "../log.js";
import { draftStores } from "../test-support/draft-stores.js";
import { fakeExec, ok } from "../test-support/fake-exec.js";
import { listenBridge, SocketTransport } from "./server.js";
import { BridgeSessions } from "./sessions.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

async function bridge(drafts: Array<"pr" | "review">) {
  const t = draftStores();
  const sessions = new BridgeSessions();
  const token = sessions.mint({ itemId: "item-1", drafts });
  const path = join(await mkdtemp(join(tmpdir(), "dp-br-")), "mcp.sock");
  const exec = fakeExec({
    "git -C /wt/1 log": ok("a1b2c3\tFix the flaky test\n"),
    "git -C /wt/1 status": ok(""),
  });
  const server = await listenBridge({ ...t.deps, exec, sessions, log: silentLog, version: "0.0.0-test" }, path);
  cleanup.push(server.close);
  return { ...t, sessions, token, path };
}

/** Raw handshake: returns the welcome line and the socket. */
function hello(path: string, line: string): Promise<{ welcome: any; socket: Socket; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    const socket = connect(path, () => socket.write(`${line}\n`));
    let buf = "";
    socket.on("error", reject);
    socket.on("data", function onData(c: Buffer) {
      buf += c.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      socket.off("data", onData);
      resolve({ welcome: JSON.parse(buf.slice(0, nl)), socket, rest: Buffer.from(buf.slice(nl + 1)) });
    });
  });
}

async function client(path: string, token: string): Promise<Client> {
  const { welcome, socket, rest } = await hello(path, JSON.stringify({ bridge: 1, token }));
  expect(welcome).toEqual({ ok: true });
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new SocketTransport(socket, rest));
  cleanup.push(() => c.close());
  return c;
}

describe("bridge server", () => {
  it("refuses an unknown token, a revoked one and another protocol version", async () => {
    const b = await bridge(["pr"]);
    expect((await hello(b.path, JSON.stringify({ bridge: 1, token: "nope" }))).welcome).toMatchObject({ ok: false, reason: /unknown session token/ });
    expect((await hello(b.path, JSON.stringify({ bridge: 2, token: b.token }))).welcome).toMatchObject({ ok: false, reason: /protocol 2/ });
    expect((await hello(b.path, "not json")).welcome).toMatchObject({ ok: false });
    b.sessions.revoke(b.token);
    expect((await hello(b.path, JSON.stringify({ bridge: 1, token: b.token }))).welcome.ok).toBe(false);
  });

  it("answers initialize and lists only the drafts the playbook allows", async () => {
    const a = await bridge(["pr"]);
    const withPr = await client(a.path, a.token);
    expect(withPr.getServerVersion()).toMatchObject({ name: "donepm" });
    expect((await withPr.listTools()).tools.map((t) => t.name)).toEqual(["whoami", "draft_pr", "draft_push", "draft_comment"]);

    const b = await bridge([]);
    const noPr = await client(b.path, b.token);
    expect((await noPr.listTools()).tools.map((t) => t.name)).toEqual(["whoami"]);

    const r = await bridge(["review"]);
    const review = await client(r.path, r.token);
    expect((await review.listTools()).tools.map((t) => t.name)).toEqual(["whoami", "draft_review"]);
    expect((await review.callTool({ name: "draft_push", arguments: { message: "x" } })).isError).toBe(true);
    expect(r.drafts.forItem("item-1")).toEqual([]);
    // A tool the playbook does not allow is an error result, not a JSON-RPC error.
    const res = await noPr.callTool({ name: "draft_pr", arguments: { title: "x", body: "" } });
    expect(res.isError).toBe(true);
    expect(b.drafts.forItem("item-1")).toEqual([]);
    expect(b.state()).toBe("running");
  });

  it("whoami names the item, branch and worktree", async () => {
    const b = await bridge(["pr"]);
    const res = await (await client(b.path, b.token)).callTool({ name: "whoami", arguments: {} });
    const who = JSON.parse((res.content as any)[0].text);
    expect(who).toMatchObject({ itemId: "item-1", branch: "dp/1-fix-it", worktreePath: "/wt/1", repo: { origin: "github.com/o/r" } });
  });

  it("draft_pr creates a pending draft and answers in a sentence; a second one is refused", async () => {
    const b = await bridge(["pr"]);
    const c = await client(b.path, b.token);
    const res = await c.callTool({ name: "draft_pr", arguments: { title: "Fix it", body: "Closes #1" } });
    expect(res).toEqual({ content: [{ type: "text", text: "Draft created, the user will review it." }] });
    expect(b.drafts.pending("item-1")).toHaveLength(1);
    expect(b.state()).toBe("needs_you");
    expect(b.types().at(-1)).toBe("draft.created");

    const again = await c.callTool({ name: "draft_pr", arguments: { title: "Again", body: "" } });
    expect(again.isError).toBe(true);
    const bad = await c.callTool({ name: "draft_pr", arguments: { body: "no title" } });
    expect(bad.isError).toBe(true);
  });

  it("draft_push proposes the new commits for the open PR; without one it points to draft_pr", async () => {
    const b = await bridge(["pr"]);
    const c = await client(b.path, b.token);
    expect((await c.callTool({ name: "draft_push", arguments: { summary: "Fix CI" } })).content).toEqual([
      { type: "text", text: "No draft was created: there is no pull request yet; call draft_pr instead." },
    ]);
    b.drafts.insert({ id: "d-pr", itemId: "item-1", type: "pr", payload: { title: "Fix it", body: "", base: "main" }, state: "executed" }, "2026-10-01T00:00:00.000Z");
    b.drafts.setResult("d-pr", { number: 7, url: "https://github.com/o/r/pull/7" }, "2026-10-01T00:00:00.000Z");

    expect(await c.callTool({ name: "draft_push", arguments: { summary: "Fix CI" } })).toEqual({
      content: [{ type: "text", text: "Draft created, the user will review it." }],
    });
    expect(b.drafts.pending("item-1")).toMatchObject([
      {
        type: "push",
        payload: { summary: "Fix CI", number: 7, branch: "dp/1-fix-it", commits: [{ sha: "a1b2c3", subject: "Fix the flaky test" }], uncommitted: false },
      },
    ]);
    expect(b.state()).toBe("needs_you");
    expect((await c.callTool({ name: "draft_push", arguments: {} })).isError).toBe(true);
  });
  it("draft_comment and draft_push replies may only answer threads the feedback brought in (D39)", async () => {
    const b = await bridge(["pr"]);
    const c = await client(b.path, b.token);
    expect((await c.callTool({ name: "draft_comment", arguments: { replies: [{ body: "Done" }] } })).content).toEqual([
      { type: "text", text: "No draft was created: there is no pull request to comment on." },
    ]);
    b.drafts.insert({ id: "d-pr", itemId: "item-1", type: "pr", payload: { title: "Fix it", body: "", base: "main" }, state: "executed" }, "2026-10-01T00:00:00.000Z");
    b.drafts.setResult("d-pr", { number: 7, url: "https://github.com/o/r/pull/7" }, "2026-10-01T00:00:00.000Z");
    const entry = { kind: "inline", id: 42, author: "ana", body: "Rename", url: "u", at: "t", path: "a.ts", line: 1, thread: 41 };
    b.events.append([{ id: "fb", itemId: "item-1", at: "2026-10-01T00:00:00.000Z", actor: "system", type: "pr.feedback", payload: { number: 7, url: "https://github.com/o/r/pull/7", entries: [entry] } }]);

    const wrong = await c.callTool({ name: "draft_push", arguments: { summary: "Rename", replies: [{ body: "Done", inReplyTo: 42 }] } });
    expect((wrong.content as any)[0].text).toMatch(/no review thread 42/);
    expect((await c.callTool({ name: "draft_comment", arguments: { replies: [] } })).isError).toBe(true);

    const res = await c.callTool({ name: "draft_comment", arguments: { replies: [{ body: "Kept it, see the test.", inReplyTo: 41 }, { body: "Thanks!" }] } });
    expect(res.isError).toBeFalsy();
    expect(b.drafts.pending("item-1")).toMatchObject([
      { type: "comment", payload: { number: 7, url: "https://github.com/o/r/pull/7", replies: [{ body: "Kept it, see the test.", inReplyTo: 41 }, { body: "Thanks!" }] } },
    ]);
    expect(b.events.forItem("item-1").at(-1)).toMatchObject({ type: "draft.created", payload: { type: "comment", title: "Reply 2 times on PR #7" } });
  });
});
