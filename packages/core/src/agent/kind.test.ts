import { describe, expect, it } from "vitest";
import { agentOf, AGENT_KINDS, chooseAgent, DEFAULT_AGENT, isAgentKind } from "./kind.js";

describe("agent kind", () => {
  it("defaults to Claude Code", () => {
    expect(DEFAULT_AGENT).toBe("claude-code");
    expect(agentOf({})).toBe("claude-code");
    expect(agentOf({ agentKind: "codex" })).toBe("codex");
  });

  it("knows its kinds", () => {
    expect(AGENT_KINDS).toEqual(["claude-code", "codex"]);
    expect(isAgentKind("claude-code")).toBe(true);
    expect(isAgentKind("codex")).toBe(true);
    for (const v of ["robot", "", undefined, 1]) expect(isAgentKind(v)).toBe(false);
  });
});

describe("chooseAgent", () => {
  it("takes the item's own choice first", () => {
    expect(chooseAgent({ item: { agentKind: "codex" }, playbook: { agent: "claude-code" }, repo: { agent: "claude-code" } })).toBe("codex");
  });

  it("then the playbook's, then the repository's", () => {
    expect(chooseAgent({ item: {}, playbook: { agent: "codex" }, repo: { agent: "claude-code" } })).toBe("codex");
    expect(chooseAgent({ item: {}, playbook: {}, repo: { agent: "codex" } })).toBe("codex");
    expect(chooseAgent({ item: {} })).toBe("claude-code");
  });

  it("keeps a session from before #136 with Claude Code", () => {
    expect(chooseAgent({ item: { agentSessionId: "s1" }, playbook: { agent: "codex" } })).toBe("claude-code");
  });
});
