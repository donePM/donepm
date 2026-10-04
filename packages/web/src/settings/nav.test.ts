import { describe, expect, it } from "vitest";
import type { Status } from "../api/types";
import { SECTIONS, sectionDot, sectionGroups } from "./nav";

describe("sectionGroups", () => {
  it("puts the six sections under Workspace, Agents and System", () => {
    expect(sectionGroups().map((g) => [g.group, g.sections.map((s) => s.id)])).toEqual([
      ["Workspace", ["general", "repositories"]],
      ["Agents", ["agents", "playbooks"]],
      ["System", ["tools", "daemon"]],
    ]);
    expect(SECTIONS).toHaveLength(6);
  });
});

describe("sectionDot", () => {
  const ready: Status = {
    version: "1", pid: 1, startedAt: "2026-10-01T00:00:00.000Z", runningAgents: 0, pollErrors: [],
    gh: { state: "ready" }, claude: { state: "ready" },
  };

  it("is green when the tools are ready, amber on a problem, grey while unknown", () => {
    for (const section of ["agents", "tools"] as const) {
      expect(sectionDot(section, ready, true)).toBe("ok");
      expect(sectionDot(section, ready, false)).toBe("attn");
      expect(sectionDot(section, undefined, true)).toBe("off");
    }
  });

  it("covers the coding agents under Agents & access, the source clients and the poll under Tools", () => {
    const claudeOut: Status = { ...ready, claude: { state: "not_logged_in" } };
    expect(sectionDot("agents", claudeOut, true)).toBe("attn");
    expect(sectionDot("tools", claudeOut, true)).toBe("ok");

    const ghOut: Status = { ...ready, gh: { state: "not_installed" } };
    expect(sectionDot("agents", ghOut, true)).toBe("ok");
    expect(sectionDot("tools", ghOut, true)).toBe("attn");

    const pollFailed: Status = { ...ready, lastPoll: { at: "x", ok: false } };
    expect(sectionDot("agents", pollFailed, true)).toBe("ok");
    expect(sectionDot("tools", pollFailed, true)).toBe("attn");
  });

  it("does not wait for a helper, which is optional", () => {
    expect(sectionDot("tools", { ...ready, helpers: { "playwright-cli": { installed: false } } }, true)).toBe("ok");
  });
});
