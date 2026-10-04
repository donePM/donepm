import { describe, expect, it } from "vitest";
import type { Status } from "../api/types";
import { SECTIONS, sectionGroups, toolsDot } from "./nav";

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

describe("toolsDot", () => {
  const ready: Status = {
    version: "1", pid: 1, startedAt: "2026-10-01T00:00:00.000Z", runningAgents: 0, pollErrors: [],
    gh: { state: "ready" }, claude: { state: "ready" },
  };

  it("is green when the tools are ready, amber on a problem, grey while unknown", () => {
    expect(toolsDot(ready, true)).toBe("ok");
    expect(toolsDot({ ...ready, claude: { state: "not_logged_in" } }, true)).toBe("attn");
    expect(toolsDot(ready, false)).toBe("attn");
    expect(toolsDot(undefined, true)).toBe("off");
  });
});
