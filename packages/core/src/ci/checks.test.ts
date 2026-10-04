import { describe, expect, it } from "vitest";
import { ciFixPrompt, ciVerdict, failedRuns, runIdOf, type CiCheck } from "./checks.js";

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
