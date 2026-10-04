import { describe, expect, it } from "vitest";
import { failedRuns, type CiPr, type FailedCheck } from "@donepm/core";
import type { CiSource } from "../../providers/ci-source.js";

/** What an adapter's test supplies to run the CI source contract (issue #138). */
export interface CiSourceScenarios {
  /** Answers with a pull request whose CI has failed jobs. */
  answering(): CiSource;
  /** Refuses every call. */
  failing(): CiSource;
  pr: CiPr;
  /** The failed checks of `pr`, as the verdict lists them; the failed logs carry their names. */
  failed: FailedCheck[];
}

/** The contract every `CiSource` meets, whatever its backend. */
export function ciSourceContract(name: string, s: CiSourceScenarios): void {
  const failedChecks = s.failed.map((c) => c.name);
  const runs = failedRuns(s.failed);
  describe(`${name}: CiSource contract`, () => {
    describe("when the provider answers", () => {
      it("lists the checks with a name, bucket and state each", async () => {
        const r = await s.answering().checks(s.pr);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        for (const c of r.checks) {
          expect(c.name).toMatch(/\S/);
          expect(["pass", "fail", "pending", "skipping", "cancel"]).toContain(c.bucket);
          expect(c.state).toMatch(/\S/);
        }
        expect(r.checks.filter((c) => c.bucket === "fail").map((c) => c.name)).toEqual(failedChecks);
      });

      it("gives one log tail per failed job, named like its check", async () => {
        const logs = await s.answering().failedLogs(s.pr, s.failed);
        expect(logs.map((l) => l.name)).toEqual(failedChecks);
        for (const l of logs) expect(l.tail).toMatch(/\S/);
      });

      it("reruns the failed jobs", async () => {
        expect(await s.answering().rerunFailed(s.pr, runs)).toEqual({ ok: true });
      });
    });

    describe("when the provider refuses", () => {
      it("fails to list the checks with the reason", async () => {
        const r = await s.failing().checks(s.pr);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/\S/);
      });

      it("gives no logs: CI's verdict does not depend on them", async () => {
        expect(await s.failing().failedLogs(s.pr, s.failed)).toEqual([]);
      });

      it("fails to rerun with the reason", async () => {
        const r = await s.failing().rerunFailed(s.pr, runs);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/\S/);
      });
    });
  });
}
