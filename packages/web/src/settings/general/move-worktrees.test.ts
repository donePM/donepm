import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import { moveQuestion, moveResult, worktreesAtOldRoot } from "./move-worktrees";

const wt = (running = false) => ({ itemId: "i", title: "Fix it", path: "/old/r/dp-1", running });

describe("moving worktrees to a new root", () => {
  it("reads the list from the daemon's 409 only", () => {
    expect(worktreesAtOldRoot(new ApiError("x", 409, { worktreesAtOldRoot: [wt()] }))).toEqual([wt()]);
    expect(worktreesAtOldRoot(new ApiError("x", 409, { error: "other" }))).toBeUndefined();
    expect(worktreesAtOldRoot(new ApiError("x", 400, { worktreesAtOldRoot: [wt()] }))).toBeUndefined();
    expect(worktreesAtOldRoot(new Error("x"))).toBeUndefined();
  });

  it("asks with the count and says which stay because their agent runs", () => {
    expect(moveQuestion([wt()])).toEqual({ title: "1 worktree is in the old location. Move it to the new one?" });
    expect(moveQuestion([wt(), wt(true), wt(true)])).toEqual({
      title: "3 worktrees are in the old location. Move them to the new one?",
      note: "2 have a running agent and stay where they are.",
    });
  });

  it("reports what moved and why the rest did not", () => {
    expect(moveResult({ moved: [{ itemId: "i", title: "A", from: "/a", to: "/b" }], skipped: [] })).toBe("Saved. Moved 1 worktree.");
    expect(moveResult({ moved: [], skipped: [{ itemId: "i", title: "B", path: "/a", reason: "its agent is running" }] })).toBe(
      "Saved. Nothing moved. Not moved: B (its agent is running).",
    );
  });
});
