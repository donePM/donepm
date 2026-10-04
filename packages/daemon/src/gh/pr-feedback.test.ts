import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fetchPrFeedback } from "./pr-feedback.js";

const pr = { url: "https://github.com/vuejs/core/pull/15751", number: 15751 };
const CMD = "gh api graphql --hostname github.com -F owner=vuejs -F name=core -F number=15751";

describe("fetchPrFeedback", () => {
  it("keeps reviewers' feedback and leaves out the author's own replies and bots", async () => {
    const r = await fetchPrFeedback(fakeExec({ [CMD]: ok(fixture("gh/pr-feedback.json")) }), pr);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => [e.kind, e.id, e.author])).toEqual([
      ["inline", 4165356352, "edison1105"],
      ["review", 5391336062, "edison1105"],
    ]);
    expect(r.entries[0]).toMatchObject({
      path: "packages/compiler-vapor/src/generators/expression.ts",
      line: 1029,
      thread: 4165356352,
      url: expect.stringContaining("#discussion_r4165356352"),
    });
    expect(r.entries[0]?.diffHunk).toMatch(/^@@ -1024,6 \+1024,17 @@/);
    expect(r.entries[1]).toMatchObject({ state: "CHANGES_REQUESTED", body: "" });
  });

  it("takes people's conversation comments; a reply in a thread keeps the thread's first comment", async () => {
    const raw = JSON.parse(fixture("gh/pr-feedback.json"));
    const pull = raw.data.repository.pullRequest;
    pull.comments.nodes.push({ databaseId: 77, body: "Why not a map?", createdAt: "2026-10-04T09:00:00Z", url: "https://x/77", author: { login: "ana", __typename: "User" } });
    pull.reviews.nodes[2].author.login = "ana";
    pull.reviews.nodes[2].comments.nodes[0].author.login = "ana";
    const r = await fetchPrFeedback(fakeExec({ [CMD]: ok(JSON.stringify(raw)) }), pr);
    const entries = r.ok ? r.entries : [];
    expect(entries.find((e) => e.id === 77)).toMatchObject({ kind: "comment", author: "ana", body: "Why not a map?" });
    expect(entries.find((e) => e.id === 4165439215)).toMatchObject({ kind: "inline", thread: 4165356352 });
  });

  it("leaves out approvals and empty comment reviews", async () => {
    const raw = JSON.parse(fixture("gh/pr-feedback.json"));
    const reviews = raw.data.repository.pullRequest.reviews.nodes;
    reviews[1].state = "APPROVED";
    reviews[0].comments.nodes = [];
    const r = await fetchPrFeedback(fakeExec({ [CMD]: ok(JSON.stringify(raw)) }), pr);
    expect(r).toEqual({ ok: true, entries: [] });
  });

  it("reports gh failures and unexpected output", async () => {
    expect(await fetchPrFeedback(fakeExec({ [CMD]: fail("HTTP 502") }), pr)).toEqual({ ok: false, error: "HTTP 502" });
    expect((await fetchPrFeedback(fakeExec({ [CMD]: ok("{}") }), pr)).ok).toBe(false);
    expect((await fetchPrFeedback(fakeExec({}), { url: "https://github.com/o/r/issues/1", number: 1 })).ok).toBe(false);
  });
});
