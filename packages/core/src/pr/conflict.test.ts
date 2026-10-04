import { describe, expect, it } from "vitest";
import type { Event } from "../event/types.js";
import { conflictFixPrompt, prConflictOf } from "./conflict.js";

let n = 0;
const ev = (type: string, payload: Record<string, unknown> = {}): Event => {
  n++;
  return { id: `e${n}`, itemId: "i", at: `2026-10-04T10:${String(n).padStart(2, "0")}:00Z`, actor: "system", type: type as Event["type"], payload };
};
const pr = { number: 7, url: "https://github.com/o/r/pull/7" };
const conflicted = () => ev("pr.conflicted", { ...pr, base: "main", files: ["src/index.ts"], from: "checking" });

describe("prConflictOf", () => {
  it("waits on the user while nothing moved after the conflict", () => {
    expect(prConflictOf([ev("ci.started", pr), conflicted(), ev("item.assigned")])).toEqual({
      pr, base: "main", files: ["src/index.ts"], from: "checking", waiting: true,
    });
  });

  it("stays open but stops waiting once the user dismissed it or the agent took it on", () => {
    expect(prConflictOf([conflicted(), ev("pr.conflict_dismissed", pr)])).toMatchObject({ waiting: false });
    expect(prConflictOf([conflicted(), ev("agent.resumed", { reason: "pr_conflict" })])).toMatchObject({ waiting: false });
  });

  it("is gone once resolved, and there before the next conflict", () => {
    expect(prConflictOf([conflicted(), ev("pr.conflict_resolved", pr)])).toBeUndefined();
    expect(prConflictOf([conflicted(), ev("pr.conflict_resolved", pr), conflicted()])).toMatchObject({ waiting: true });
    expect(prConflictOf([])).toBeUndefined();
  });
});

describe("conflictFixPrompt", () => {
  it("names the base and the files and asks for a merge, the build, the tests and a push draft", () => {
    const text = conflictFixPrompt({ pr, base: "main", files: ["src/index.ts"] });
    expect(text).toContain("Pull request #7 has merge conflicts with `main`");
    expect(text).toContain("- src/index.ts");
    expect(text).toContain("git merge origin/main");
    expect(text).toContain("Do not rebase and do not force push");
    expect(text).toContain("run the build and the tests");
    expect(text).toContain("draft_push");
    expect(conflictFixPrompt({ pr, base: "main", files: [] })).not.toContain("Conflicting files");
  });

  it("merges what only the PR branch on GitHub has before the base (#119)", () => {
    const text = conflictFixPrompt({ pr, base: "main", files: [] }, "dp/7-fix");
    expect(text).toContain("`origin/main` and `origin/dp/7-fix` are fetched");
    expect(text.indexOf("git merge origin/dp/7-fix")).toBeGreaterThan(-1);
    expect(text.indexOf("git merge origin/dp/7-fix")).toBeLessThan(text.indexOf("git merge origin/main"));
    expect(conflictFixPrompt({ pr, base: "main", files: [] })).not.toContain("origin/dp/7-fix");
  });
});
