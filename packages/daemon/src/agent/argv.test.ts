import { describe, expect, it } from "vitest";
import { askAnswerLine, claudeArgv, userTurnLine } from "./argv.js";

const playbook = { model: "opus", permissionMode: "acceptEdits" as const };

describe("claudeArgv", () => {
  it("builds the spec 9.1 argv", () => {
    expect(claudeArgv({ playbook })).toEqual([
      "-p",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode", "acceptEdits",
      "--permission-prompt-tool", "stdio",
      "--model", "opus",
      "--settings", expect.any(String),
    ]);
  });

  it("denies forge commands and sandboxes Bash with no way out (D27)", () => {
    const args = claudeArgv({ playbook, home: "/Users/x" });
    expect(JSON.parse(args[args.indexOf("--settings") + 1]!)).toEqual({
      permissions: { allow: ["mcp__donepm"], deny: ["Bash(gh *)", "Bash(glab *)", "Bash(jira *)", "Bash(git push*)"] },
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        filesystem: { allowWrite: ["/Users/x/Library/Caches", "/Users/x/.cache", "/Users/x/.npm"] },
      },
    });
  });

  it("adds effort, mcp config and resume when given", () => {
    const args = claudeArgv({
      playbook: { ...playbook, effort: "high" },
      mcpConfigPath: "/tmp/mcp-1.json",
      resumeSessionId: "sess-1",
    });
    expect(args.slice(args.indexOf("--model"))).toEqual([
      "--model", "opus",
      "--effort", "high",
      "--settings", expect.any(String),
      "--mcp-config", "/tmp/mcp-1.json",
      "--resume", "sess-1",
    ]);
  });

  it("never passes --strict-mcp-config", () => {
    expect(claudeArgv({ playbook, mcpConfigPath: "/x" })).not.toContain("--strict-mcp-config");
  });
});

describe("stdin lines", () => {
  it("writes a user turn", () => {
    expect(JSON.parse(userTurnLine("do it"))).toEqual({
      type: "user", message: { role: "user", content: [{ type: "text", text: "do it" }] },
    });
  });

  it("answers allow with the unedited input", () => {
    expect(JSON.parse(askAnswerLine("r1", { behavior: "allow", input: { command: "ls" } }))).toEqual({
      type: "control_response",
      response: { request_id: "r1", subtype: "success", response: { behavior: "allow", updatedInput: { command: "ls" } } },
    });
  });

  it("grants rules for the session on an allow for the run", () => {
    const line = askAnswerLine("r1", {
      behavior: "allow", input: { command: "curl x" }, rules: [{ toolName: "Bash", ruleContent: "curl *" }],
    });
    expect(JSON.parse(line).response.response).toEqual({
      behavior: "allow",
      updatedInput: { command: "curl x" },
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "curl *" }], behavior: "allow", destination: "session" }],
    });
  });

  it("sends no updatedPermissions for an empty grant", () => {
    expect(JSON.parse(askAnswerLine("r1", { behavior: "allow", input: {}, rules: [] })).response.response).toEqual({
      behavior: "allow", updatedInput: {},
    });
  });

  it("refuses to grant a rule the deny list forbids", () => {
    expect(() => askAnswerLine("r1", { behavior: "allow", input: {}, rules: [{ toolName: "Bash", ruleContent: "git push*" }] })).toThrow(/refusing/);
    expect(() => askAnswerLine("r1", { behavior: "allow", input: {}, rules: [{ toolName: "Bash" }] })).toThrow(/refusing/);
  });

  it("answers deny with a message", () => {
    expect(JSON.parse(askAnswerLine("r1", { behavior: "deny", message: "no" })).response.response).toEqual({
      behavior: "deny", message: "no",
    });
  });
});
