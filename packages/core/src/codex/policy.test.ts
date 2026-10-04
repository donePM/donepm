import { describe, expect, it } from "vitest";
import { codexModel, codexPolicy } from "./policy.js";

describe("codexPolicy", () => {
  it("asks before any write in default mode", () => {
    expect(codexPolicy({ permissionMode: "default" })).toEqual({ approvalPolicy: "on-request", approvalsReviewer: "user", extends: ":read-only" });
  });

  it("writes in the worktree only with acceptEdits", () => {
    expect(codexPolicy({ permissionMode: "acceptEdits" }).extends).toBe(":workspace");
  });

  it("keeps a read_only playbook read-only whatever the mode says", () => {
    expect(codexPolicy({ permissionMode: "acceptEdits", readOnly: true }).extends).toBe(":read-only");
  });

  it("refuses plan and bypassPermissions", () => {
    expect(() => codexPolicy({ permissionMode: "plan" })).toThrow(/plan is not available with codex/);
    expect(() => codexPolicy({ permissionMode: "bypassPermissions" })).toThrow(/bypassPermissions/);
  });
});

describe("codexModel", () => {
  it("drops Claude model names so Codex uses its default", () => {
    for (const m of ["opus", "sonnet", "haiku", "opus[1m]", "claude-opus-4-1", "Sonnet", "", "  ", undefined]) expect(codexModel(m)).toBeUndefined();
  });

  it("passes other names on", () => {
    expect(codexModel("gpt-5.5")).toBe("gpt-5.5");
    expect(codexModel(" o4-mini ")).toBe("o4-mini");
  });
});
