import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fetchFailedLogs, fetchPrChecks } from "./pr-checks.js";

const pr = { url: "https://github.com/donePM/donepm/pull/62", number: 62 };
const CMD = "gh pr checks 62 --repo github.com/donePM/donepm --json name,state,bucket,link,workflow,startedAt,completedAt";

describe("fetchPrChecks", () => {
  it("reads failed checks although gh exits 1", async () => {
    const r = await fetchPrChecks(fakeExec({ [CMD]: { code: 1, stdout: fixture("gh/pr-checks-fail.json"), stderr: "" } }), pr);
    expect(r.ok && r.checks.map((c) => c.bucket)).toEqual(["fail", "fail", "pass", "pass"]);
    expect(r.ok && r.checks[0]).toEqual({
      name: "test (ubuntu-latest, node 24)",
      state: "FAILURE",
      bucket: "fail",
      link: "https://github.com/donePM/donepm/actions/runs/37149187747/job/111279498956",
      workflow: "test",
      startedAt: "2026-10-03T19:49:17Z",
      completedAt: "2026-10-03T19:49:59Z",
    });
  });

  it("reads pending checks although gh exits 8, without gh's zero timestamps", async () => {
    const r = await fetchPrChecks(fakeExec({ [CMD]: { code: 8, stdout: fixture("gh/pr-checks-pending.json"), stderr: "" } }), pr);
    expect(r.ok).toBe(true);
    const pending = r.ok ? r.checks.filter((c) => c.bucket === "pending") : [];
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((c) => c.completedAt === undefined)).toBe(true);
  });

  it("reads passed checks", async () => {
    const r = await fetchPrChecks(fakeExec({ [CMD]: ok(fixture("gh/pr-checks-pass.json")) }), pr);
    expect(r.ok && r.checks.every((c) => c.bucket === "pass")).toBe(true);
  });

  it("takes 'no checks reported' as no checks", async () => {
    expect(await fetchPrChecks(fakeExec({ [CMD]: fail(fixture("gh/pr-checks-none.stderr")) }), pr)).toEqual({ ok: true, checks: [] });
  });

  it("reports gh failures and unexpected output", async () => {
    expect(await fetchPrChecks(fakeExec({ [CMD]: fail("HTTP 502") }), pr)).toEqual({ ok: false, error: "HTTP 502" });
    expect(await fetchPrChecks(fakeExec({ [CMD]: ok('[{"name":1}]') }), pr)).toMatchObject({ ok: false });
    expect(await fetchPrChecks(fakeExec({}), { url: "https://github.com/o/r", number: 1 })).toMatchObject({ ok: false });
  });
});

describe("fetchFailedLogs", () => {
  const RUN = "gh run view 37149187747 --repo github.com/donePM/donepm --log-failed";

  it("tails each failed job's log without timestamps and colours", async () => {
    const logs = await fetchFailedLogs(fakeExec({ [RUN]: ok(fixture("gh/run-view-log-failed.txt")) }), "github.com/donePM/donepm", "37149187747", 10);
    expect(logs.map((l) => l.name)).toEqual(["test (ubuntu-latest, node 24)", "test (ubuntu-latest, node 22)"]);
    for (const l of logs) {
      expect(l.tail.split("\n")).toHaveLength(10);
      expect(l.tail).not.toMatch(/\u001b|\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z/);
    }
  });

  it("gives no logs when gh fails", async () => {
    expect(await fetchFailedLogs(fakeExec({ [RUN]: fail("run not found") }), "github.com/donePM/donepm", "37149187747")).toEqual([]);
  });
});
