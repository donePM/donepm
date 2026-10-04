import { describe, expect, it } from "vitest";
import { askAnswerLine, claudeArgv, userTurnLine } from "./argv.js";

const playbook = { model: "opus", permissionMode: "acceptEdits" as const };

const BASE_DENY = [
  "Bash(gh *)", "Bash(glab *)", "Bash(jira *)", "Bash(az *)", "Bash(acli *)", "Bash(security *)", "Bash(git push*)",
  "Bash(/usr/bin/security *)", "Bash(env security *)", "Bash(env /usr/bin/security *)", "Bash(/usr/bin/env security *)",
  "Bash(/usr/bin/env /usr/bin/security *)", "Bash(command security *)", "Bash(exec security *)", "Bash(xcrun security *)",
  "Read(~/Library/Keychains/**)",
];

const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf("--settings") + 1]!);

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
    expect(settingsOf(args)).toEqual({
      permissions: { allow: ["mcp__donepm"], deny: BASE_DENY },
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        filesystem: {
          allowWrite: ["/Users/x/Library/Caches", "/Users/x/.cache", "/Users/x/.npm"],
          denyRead: ["~/Library/Keychains", "/Users/x/Library/Keychains"],
        },
      },
    });
  });

  describe("keeps the agent out of the Keychain (issue #170, D50)", () => {
    it("denies reading the Keychain files in the sandbox, for every playbook, with or without a home", () => {
      for (const p of [playbook, { ...playbook, readOnly: true }]) {
        expect(settingsOf(claudeArgv({ playbook: p, home: "/Users/x" })).sandbox.filesystem.denyRead)
          .toEqual(["~/Library/Keychains", "/Users/x/Library/Keychains"]);
        expect(settingsOf(claudeArgv({ playbook: p })).sandbox.filesystem).toEqual({ denyRead: ["~/Library/Keychains"] });
      }
    });

    it("keeps the sandbox closed: no setting that would re-open the Keychain or its services", () => {
      const { sandbox } = settingsOf(claudeArgv({ playbook, home: "/Users/x" }));
      expect(sandbox.allowUnsandboxedCommands).toBe(false);
      expect(sandbox.filesystem.allowRead).toBeUndefined();
      expect(sandbox.network).toBeUndefined();
      expect(sandbox.allowAppleEvents).toBeUndefined();
      expect(sandbox.enableWeakerNestedSandbox).toBeUndefined();
    });

    it("denies the Read tools the Keychain files, since they run outside the sandbox", () => {
      expect(settingsOf(claudeArgv({ playbook })).permissions.deny).toContain("Read(~/Library/Keychains/**)");
    });

    it("denies `security` spelled out by path or behind a launcher, as defence in depth", () => {
      const { deny } = settingsOf(claudeArgv({ playbook })).permissions;
      for (const rule of ["Bash(security *)", "Bash(/usr/bin/security *)", "Bash(/usr/bin/env security *)", "Bash(env security *)"]) {
        expect(deny).toContain(rule);
      }
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
    expect(claudeArgv({ playbook: { ...playbook, readOnly: true }, mcpConfigPath: "/x" })).not.toContain("--strict-mcp-config");
  });

  it("locks a read-only playbook to reading (D42)", () => {
    const args = claudeArgv({ playbook: { model: "opus", permissionMode: "default", readOnly: true }, home: "/Users/x" });
    expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "default"]);
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]!);
    expect(settings.permissions).toEqual({
      allow: ["mcp__donepm", "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)"],
      deny: [
        ...BASE_DENY,
        "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch",
      ],
    });
    expect(settings.sandbox).toMatchObject({ enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false });
    expect(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2)).toEqual(["--setting-sources", "user"]);
  });

  it("loads every setting source for a playbook that is not read-only", () => {
    expect(claudeArgv({ playbook })).not.toContain("--setting-sources");
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

  it("adds interrupt to a deny only when asked", () => {
    expect(JSON.parse(askAnswerLine("r1", { behavior: "deny", message: "no", interrupt: true })).response.response).toEqual({
      behavior: "deny", message: "no", interrupt: true,
    });
    expect(JSON.parse(askAnswerLine("r1", { behavior: "deny", message: "no", interrupt: false })).response.response).not.toHaveProperty("interrupt");
  });
});
