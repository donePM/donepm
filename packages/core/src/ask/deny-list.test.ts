import { describe, expect, it } from "vitest";
import { BLOCKED_COMMANDS, blockedCommand, DENY_RULES } from "./deny-list.js";

/** Whether a `Bash(prefix*)` or `Bash(prefix *)` deny rule covers a command, as Claude Code matches them. */
function denied(command: string): boolean {
  return DENY_RULES.some((rule) => {
    const body = /^Bash\((.*)\)$/.exec(rule)?.[1];
    if (!body?.endsWith("*")) return body === command;
    const prefix = body.slice(0, -1);
    return command.startsWith(prefix) || (prefix.endsWith(" ") && command === prefix.trimEnd());
  });
}

describe("DENY_RULES", () => {
  it("keeps az, and with it Azure DevOps, out of the agent's reach (issue #141)", () => {
    expect(BLOCKED_COMMANDS).toContain("az");
    for (const c of ["az repos pr create --title x", "az rest --method get --url https://dev.azure.com/acme/_apis/projects", "az devops invoke --area git"]) {
      expect(denied(c), c).toBe(true);
    }
  });

  it("covers `security` spelled out by path or behind a launcher (issue #170, defence in depth)", () => {
    for (const c of [
      "security find-generic-password -s donepm -a github -w",
      "/usr/bin/security find-generic-password -s donepm -w",
      "env security dump-keychain",
      "/usr/bin/env security find-internet-password -s github.com -w",
      "/usr/bin/env /usr/bin/security find-generic-password -w",
      "command security find-generic-password -w",
      "exec security find-generic-password -w",
      "xcrun security find-generic-password -w",
    ]) {
      expect(denied(c), c).toBe(true);
    }
    expect(denied("securityscan .")).toBe(false);
  });

  it("covers every git push, where the Git Credential Manager would hand over an Azure DevOps login", () => {
    for (const c of [
      "git push",
      "git push origin dp/7-fix",
      "git push --force-with-lease",
      "git push https://dev.azure.com/acme/Platform/_git/legacy HEAD:main",
      "git push git@ssh.dev.azure.com:v3/acme/Platform/legacy",
    ]) {
      expect(denied(c), c).toBe(true);
    }
    expect(denied("git status")).toBe(false);
  });
});

describe("blockedCommand", () => {
  it("finds a blocked program at the start, by path, or after a separator", () => {
    expect(blockedCommand("gh pr list")).toBe("gh");
    expect(blockedCommand("/opt/homebrew/bin/gh auth token")).toBe("gh");
    expect(blockedCommand("ls && az boards work-item show --id 1")).toBe("az");
    expect(blockedCommand("echo $(security find-generic-password -s x)")).toBe("security");
    expect(blockedCommand("cd /w; acli jira workitem view X-1")).toBe("acli");
    expect(blockedCommand("env FOO=1 jira issue list")).toBe("jira");
    expect(blockedCommand("glab mr list | head")).toBe("glab");
    expect(blockedCommand("gh")).toBe("gh");
  });

  it("finds git push, with git's options between the words", () => {
    expect(blockedCommand("git push origin HEAD")).toBe("git push");
    expect(blockedCommand("git -C /w push")).toBe("git push");
    expect(blockedCommand("git add . && git commit -m x && git push")).toBe("git push");
  });

  it("leaves other commands alone", () => {
    for (const c of ["git status", "git log --grep push", "ls ghost", "cat az.txt", "echo security", "npm run gh-pages", "git commit -m 'gh'"]) {
      expect(blockedCommand(c)).toBeUndefined();
    }
  });
});
