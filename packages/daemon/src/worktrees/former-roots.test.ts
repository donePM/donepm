import { describe, expect, it } from "vitest";
import { formerRootsAfter, occupiedRoots } from "./former-roots.js";

const expand = (p: string) => p.replace(/^~/, "/home/u");

describe("former worktree roots (#93)", () => {
  it("adds the old root once and drops the new one", () => {
    expect(formerRootsAfter({ worktreeRoot: "~/wt", previousWorktreeRoots: [] }, { worktreeRoot: "/b" }, expand)).toEqual(["~/wt"]);
    expect(formerRootsAfter({ worktreeRoot: "/b", previousWorktreeRoots: ["~/wt"] }, { worktreeRoot: "/c" }, expand)).toEqual(["~/wt", "/b"]);
    // Back to a former root, also spelled differently.
    expect(formerRootsAfter({ worktreeRoot: "/b", previousWorktreeRoots: ["~/wt"] }, { worktreeRoot: "/home/u/wt" }, expand)).toEqual(["/b"]);
    expect(formerRootsAfter({ worktreeRoot: "/home/u/wt", previousWorktreeRoots: ["~/wt"] }, { worktreeRoot: "/c" }, expand)).toEqual(["~/wt"]);
  });

  it("keeps only roots that still hold a worktree", () => {
    expect(occupiedRoots(["~/wt", "/b"], ["/home/u/wt/acme-widgets/dp-1", "/c/x/y"], expand)).toEqual(["~/wt"]);
    // The root itself is no worktree under it.
    expect(occupiedRoots(["/b"], ["/b", "/bb/x"], expand)).toEqual([]);
  });
});
