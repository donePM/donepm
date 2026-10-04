import { describe, expect, it } from "vitest";
import { AGENT_CAPABILITIES, PERMISSION_MODES, playbookProblems } from "./capabilities.js";

describe("agent capabilities", () => {
  it("lets Claude Code take every permission mode and any effort", () => {
    expect(AGENT_CAPABILITIES["claude-code"].permissionModes).toEqual(PERMISSION_MODES);
    for (const permissionMode of PERMISSION_MODES) {
      expect(playbookProblems({ permissionMode, effort: "whatever" }, "claude-code")).toEqual([]);
    }
  });

  it("says Claude Code reports a price and has rules", () => {
    expect(AGENT_CAPABILITIES["claude-code"]).toMatchObject({ reportsCost: true, sessionRules: true, alwaysAllow: true });
  });

  it("refuses plan and bypassPermissions for Codex instead of widening them (#137)", () => {
    expect(playbookProblems({ permissionMode: "default" }, "codex")).toEqual([]);
    expect(playbookProblems({ permissionMode: "acceptEdits", effort: "high" }, "codex")).toEqual([]);
    expect(playbookProblems({ permissionMode: "plan" }, "codex")).toEqual(["permission_mode plan is not available with codex"]);
    expect(playbookProblems({ permissionMode: "bypassPermissions" }, "codex")).toEqual([
      "permission_mode bypassPermissions is not available with codex",
    ]);
    expect(playbookProblems({ permissionMode: "default", effort: "max" }, "codex")).toEqual(["effort max is not available with codex"]);
  });

  it("says Codex reports no price and has no rule grammar", () => {
    expect(AGENT_CAPABILITIES.codex).toMatchObject({ reportsCost: false, sessionRules: false, alwaysAllow: false, resumeInSameProcess: true });
  });

  it("names a mode or effort the agent does not take", () => {
    const caps = AGENT_CAPABILITIES["claude-code"];
    const saved = { ...caps };
    try {
      Object.assign(caps, { permissionModes: ["default"], effortLevels: ["low"] });
      expect(playbookProblems({ permissionMode: "plan", effort: "max" }, "claude-code")).toEqual([
        "permission_mode plan is not available with claude-code",
        "effort max is not available with claude-code",
      ]);
      expect(playbookProblems({ permissionMode: "default" }, "claude-code")).toEqual([]);
    } finally {
      Object.assign(caps, saved);
      delete (caps as { effortLevels?: unknown }).effortLevels;
    }
  });
});
