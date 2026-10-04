import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok, type FakeCall } from "../test-support/fake-exec.js";
import { postReview } from "./pr-review.js";
import { fetchReviewRequests } from "./review-requests.js";

const review = {
  number: 7,
  url: "https://github.com/o/r/pull/7",
  commitId: "c0ffee",
  verdict: "REQUEST_CHANGES" as const,
  body: "Two things.",
  comments: [
    { path: "src/a.ts", line: 3, body: "Off by one?" },
    { path: "src/b.ts", line: 10, body: "Unused." },
  ],
};

describe("postReview (D43)", () => {
  it("posts verdict, body and every inline comment in one request through a private file", async () => {
    let request: unknown;
    let mode = 0;
    let input = "";
    const exec = fakeExec({
      "gh api --hostname github.com --method POST repos/o/r/pulls/7/reviews --input": (c: FakeCall) => {
        input = c.args.at(-1)!;
        mode = statSync(input).mode & 0o777;
        request = JSON.parse(readFileSync(input, "utf8"));
        return ok(fixture("gh/pr-review-created.json"));
      },
    });
    expect(await postReview(exec, review)).toEqual({
      ok: true, result: { id: 3311400001, url: "https://github.com/o/r/pull/7#pullrequestreview-3311400001" },
    });
    expect(request).toEqual({
      commit_id: "c0ffee", event: "REQUEST_CHANGES", body: "Two things.",
      comments: [
        { path: "src/a.ts", line: 3, side: "RIGHT", body: "Off by one?" },
        { path: "src/b.ts", line: 10, side: "RIGHT", body: "Unused." },
      ],
    });
    expect(mode).toBe(0o600);
    expect(existsSync(input)).toBe(false);
    expect(exec.calls).toHaveLength(1);
  });

  it("reports gh's error, and an unparsable answer as posted", async () => {
    expect(await postReview(fakeExec({ "gh api": fail("HTTP 404: Not Found") }), review)).toEqual({ ok: false, error: "HTTP 404: Not Found" });
    expect(await postReview(fakeExec({ "gh api": ok("") }), review)).toEqual({ ok: true, result: { id: 0, url: review.url } });
  });

  it("uses the pull request's host", async () => {
    const exec = fakeExec({ "gh api --hostname ghe.example.com --method POST repos/o/r/pulls/7/reviews": ok(fixture("gh/pr-review-created.json")) });
    expect((await postReview(exec, { ...review, url: "https://ghe.example.com/o/r/pull/7" })).ok).toBe(true);
  });
});

describe("fetchReviewRequests (D40)", () => {
  it("searches open pull requests that request the user's review", async () => {
    const exec = fakeExec({ "gh search prs": ok(fixture("gh/search-prs.json")) });
    const r = await fetchReviewRequests(exec);
    expect(exec.calls[0]!.args.slice(0, 4)).toEqual(["search", "prs", "--review-requested=@me", "--state=open"]);
    expect(r.ok && r.issues.length > 0 && r.issues.every((i) => i.source === "github-pr")).toBe(true);
  });

  it("fails on a gh error and treats an old gh without the command as no requests", async () => {
    expect(await fetchReviewRequests(fakeExec({ "gh search prs": fail("HTTP 502") }))).toMatchObject({ ok: false, error: "HTTP 502" });
    expect(await fetchReviewRequests(fakeExec({ "gh search prs": fail("unknown command \"search\" for \"gh\"") }))).toEqual({ ok: true, issues: [] });
  });
});
