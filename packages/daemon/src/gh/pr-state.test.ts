import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fetchPrState, prRepository } from "./pr-state.js";

const pr = { url: "https://github.com/Acme/Widgets/pull/45", number: 45 };

describe("fetchPrState", () => {
  it("reads a merged PR from recorded gh output", async () => {
    const exec = fakeExec({ "gh pr view 45 --repo github.com/Acme/Widgets --json state,mergedAt": ok(fixture("gh/pr-view-merged.json")) });
    expect(await fetchPrState(exec, pr)).toEqual({ ok: true, state: "MERGED", mergedAt: "2026-10-04T08:12:31Z" });
  });

  it("reads an open PR", async () => {
    const exec = fakeExec({ "gh pr view": ok(fixture("gh/pr-view-open.json")) });
    expect(await fetchPrState(exec, pr)).toEqual({ ok: true, state: "OPEN", mergedAt: null });
  });

  it("reports gh failures and unexpected output", async () => {
    expect(await fetchPrState(fakeExec({ "gh pr view": fail("HTTP 404") }), pr)).toEqual({ ok: false, error: "HTTP 404" });
    expect(await fetchPrState(fakeExec({ "gh pr view": ok('{"state":"DRAFT"}') }), pr)).toMatchObject({ ok: false });
    expect(await fetchPrState(fakeExec({}), { url: "https://github.com/o/r/issues/1", number: 1 })).toMatchObject({ ok: false });
  });
});

describe("prRepository", () => {
  it("takes host, owner and repo from a PR URL", () => {
    expect(prRepository(pr.url)).toBe("github.com/Acme/Widgets");
    expect(prRepository("https://github.com/o/r")).toBeUndefined();
  });
});
