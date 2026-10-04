import { describe, expect, it } from "vitest";
import { BLOCKED_COMMANDS, DENY_RULES } from "./deny-list.js";

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
