import { describe, expect, it } from "vitest";
import { codexModel, codexPolicy } from "./policy.js";

describe("codexPolicy", () => {
  it("asks before any write in default mode, with the network off", () => {
    expect(codexPolicy({ permissionMode: "default" }, "/w")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "read-only",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
  });

  it("writes in the worktree only with acceptEdits", () => {
    const p = codexPolicy({ permissionMode: "acceptEdits" }, "/w");
    expect(p.sandbox).toBe("workspace-write");
    expect(p.sandboxPolicy).toEqual({ type: "workspaceWrite", writableRoots: ["/w"], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false });
  });

  it("keeps a read_only playbook read-only whatever the mode says", () => {
    expect(codexPolicy({ permissionMode: "acceptEdits", readOnly: true }, "/w").sandbox).toBe("read-only");
  });

  it("refuses plan and bypassPermissions", () => {
    expect(() => codexPolicy({ permissionMode: "plan" }, "/w")).toThrow(/plan is not available with codex/);
    expect(() => codexPolicy({ permissionMode: "bypassPermissions" }, "/w")).toThrow(/bypassPermissions/);
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
