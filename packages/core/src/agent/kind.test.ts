import { describe, expect, it } from "vitest";
import { agentOf, chooseAgent, DEFAULT_AGENT, isAgentKind } from "./kind.js";

describe("agent kind", () => {
  it("defaults to Claude Code", () => {
    expect(DEFAULT_AGENT).toBe("claude-code");
    expect(agentOf({})).toBe("claude-code");
    expect(agentOf({ agentKind: "claude-code" })).toBe("claude-code");
  });

  it("knows its kinds", () => {
    expect(isAgentKind("claude-code")).toBe(true);
    for (const v of ["codex", "", undefined, 1]) expect(isAgentKind(v)).toBe(false);
  });
});

describe("chooseAgent", () => {
  // Only one agent exists yet; the order is checked through a cast, the way #137 will use it.
  const other = "other" as unknown as "claude-code";

  it("takes the item's own choice first", () => {
    expect(chooseAgent({ item: { agentKind: other }, playbook: { agent: "claude-code" }, repo: { agent: "claude-code" } })).toBe(other);
  });

  it("then the playbook's, then the repository's", () => {
    expect(chooseAgent({ item: {}, playbook: { agent: other }, repo: { agent: "claude-code" } })).toBe(other);
    expect(chooseAgent({ item: {}, playbook: {}, repo: { agent: other } })).toBe(other);
    expect(chooseAgent({ item: {} })).toBe("claude-code");
  });

  it("keeps a session from before #136 with Claude Code", () => {
    expect(chooseAgent({ item: { agentSessionId: "s1" }, playbook: { agent: other } })).toBe("claude-code");
  });
});
