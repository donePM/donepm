import { describe, expect, it } from "vitest";
import { ciFixPrompt, ciVerdict, countOnce, failedRuns, isAzureRun, runIdOf, runOf, type CiCheck } from "./checks.js";

const since = "2026-10-04T10:00:00Z";
const later = (s: number) => new Date(Date.parse(since) + s * 1000).toISOString();
const check = (bucket: string, over: Partial<CiCheck> = {}): CiCheck => ({ name: `c-${bucket}`, bucket, state: bucket.toUpperCase(), ...over });

describe("ciVerdict", () => {
  it("waits for checks to register, then counts no checks as passed", () => {
    expect(ciVerdict([], since, later(30))).toEqual({ kind: "pending" });
    expect(ciVerdict([], since, later(60))).toEqual({ kind: "passed", checks: 0 });
  });

  it("passes when every check passed or was skipped", () => {
    expect(ciVerdict([check("pass"), check("skipping")], since, later(5))).toEqual({ kind: "passed", checks: 2 });
  });

  it("waits for every check before calling it red", () => {
    expect(ciVerdict([check("fail"), check("pending")], since, later(300))).toEqual({ kind: "pending" });
  });

  it("lists failed and cancelled checks", () => {
    const link = "https://github.com/o/r/actions/runs/1/job/2";
    expect(ciVerdict([check("pass"), check("fail", { link, workflow: "test" }), check("cancel")], since, later(300))).toEqual({
      kind: "failed",
      failed: [{ name: "c-fail", link, workflow: "test" }, { name: "c-cancel" }],
    });
  });

  it("treats a failure from before the wait as stale during the grace period", () => {
    const old = check("fail", { completedAt: "2026-10-04T09:59:00Z" });
    expect(ciVerdict([old], since, later(20))).toEqual({ kind: "pending" });
    expect(ciVerdict([old], since, later(61))).toMatchObject({ kind: "failed" });
    expect(ciVerdict([check("fail", { completedAt: later(10) })], since, later(20))).toMatchObject({ kind: "failed" });
  });

  it("counts an unknown bucket as pending", () => {
    expect(ciVerdict([check("pass"), check("waiting")], since, later(300))).toEqual({ kind: "pending" });
  });
});

describe("runIdOf and failedRuns", () => {
  it("reads the run from an Actions link", () => {
    expect(runIdOf("https://github.com/donePM/donepm/actions/runs/37149187747/job/111279498956")).toBe("37149187747");
    expect(runIdOf("https://github.com/o/r/actions/runs/5")).toBe("5");
    expect(runIdOf("https://ci.example.com/build/5")).toBeUndefined();
    expect(runIdOf(undefined)).toBeUndefined();
  });

  it("dedupes runs and skips checks without one", () => {
    expect(
      failedRuns([
        { name: "a", link: "https://github.com/o/r/actions/runs/1/job/2" },
        { name: "b", link: "https://github.com/o/r/actions/runs/1/job/3" },
        { name: "c", link: "https://ci.example.com/x" },
        { name: "d" },
      ]),
    ).toEqual(["1"]);
  });
});

describe("runOf", () => {
  const build = "https://dev.azure.com/acme/platform/_build/results?buildId=812";

  it("names an Azure Pipelines build by its URL, whatever host form or job the link has", () => {
    expect(runOf("https://dev.azure.com/acme/Platform/_build/results?buildId=812&view=logs&jobId=AB-1")).toBe(build);
    expect(runOf("https://acme.visualstudio.com/Platform/_build/results?buildId=812")).toBe(build);
    expect(runOf("https://github.com/o/r/actions/runs/5/job/6")).toBe("5");
    expect(runOf("https://ci.example.com/x")).toBeUndefined();
    expect(isAzureRun(build)).toBe(true);
    expect(isAzureRun("5")).toBe(false);
  });

  it("puts Azure builds among the failed runs, once each", () => {
    expect(
      failedRuns([
        { name: "a", link: `${build}&view=logs&jobId=1` },
        { name: "b", link: `${build}&view=logs&jobId=2` },
        { name: "c", link: "https://github.com/o/r/actions/runs/1/job/2" },
      ]),
    ).toEqual([build, "1"]);
  });
});

describe("countOnce", () => {
  const link = "https://dev.azure.com/acme/platform/_build/results?buildId=812";
  const az = (bucket: string, startedAt: string, over: Partial<CiCheck> = {}): CiCheck => ({ name: "ci", bucket, state: bucket, link, startedAt, ...over });

  it("counts one build once, its latest attempt winning", () => {
    const first = az("fail", later(10), { completedAt: later(40) });
    const retry = az("pass", later(100), { completedAt: later(160) });
    expect(countOnce([first, retry])).toEqual([retry]);
    expect(countOnce([retry, first])).toEqual([retry]);
  });

  it("lets a retry that still runs win over the attempt it retries", () => {
    const first = az("fail", later(10), { completedAt: later(40) });
    const running = az("pending", later(100));
    expect(countOnce([first, running])).toEqual([running]);
    expect(ciVerdict(countOnce([first, running]), since, later(300))).toEqual({ kind: "pending" });
  });

  it("takes the finished view of one attempt, then the one that finished last", () => {
    const running = az("pending", later(10));
    const finished = az("fail", later(10), { completedAt: later(40) });
    const stale = az("pass", later(10), { completedAt: later(30) });
    expect(countOnce([running, finished])).toEqual([finished]);
    expect(countOnce([finished, running])).toEqual([finished]);
    expect(countOnce([stale, finished])).toEqual([finished]);
  });

  it("keys by build across host forms, and keeps jobs of one build and other checks apart", () => {
    const legacy = az("fail", later(50), { link: "https://acme.visualstudio.com/Platform/_build/results?buildId=812" });
    const job = az("fail", later(5), { link: `${link}&view=logs&jobId=j1` });
    const actions = check("fail", { link: "https://github.com/o/r/actions/runs/1/job/2" });
    const actions2 = check("fail", { link: "https://github.com/o/r/actions/runs/1/job/3" });
    expect(countOnce([az("pass", later(10)), legacy, job, actions, actions2, check("pass")])).toEqual([legacy, job, actions, actions2, check("pass")]);
  });

  it("feeds a verdict over a mixed list that counts the build once", () => {
    const checks = [check("pass", { name: "lint" }), az("fail", later(5), { completedAt: later(20) }), az("fail", later(5), { completedAt: later(20) })];
    expect(ciVerdict(countOnce(checks), since, later(300))).toEqual({ kind: "failed", failed: [{ name: "ci", link }] });
  });
});

describe("ciFixPrompt", () => {
  it("names the PR, the failed checks and carries the logs", () => {
    const text = ciFixPrompt({ number: 12, failed: [{ name: "test (node 22)" }], logs: [{ name: "test (node 22)", tail: "FAIL a.test.ts" }] });
    expect(text).toContain("CI failed on pull request #12");
    expect(text).toContain("- test (node 22)");
    expect(text).toContain('Log of "test (node 22)" (end):\n```\nFAIL a.test.ts\n```');
    expect(text).toContain("draft_push");
  });

  it("says when no logs were available", () => {
    expect(ciFixPrompt({ failed: [{ name: "lint" }], logs: [] })).toContain("No logs were available.");
  });
});
