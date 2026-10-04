import { describe, expect, it } from "vitest";
import { matchGrants, rawRule, repoName, sameRule, type PermissionGrant } from "./grants.js";

const none = { suppressAlwaysAllowRule: false, requiresUserInteraction: false };
const bash = (ruleContent?: string) => (ruleContent === undefined ? { toolName: "Bash" } : { toolName: "Bash", ruleContent });
let n = 0;
const grant = (rule: { toolName: string; ruleContent?: string }, extra: Partial<PermissionGrant> = {}): PermissionGrant => ({
  id: `g${++n}`, repo: "github.com/o/r", createdAt: "2026-10-04T00:00:00.000Z", askId: "a", itemId: "i", call: "Bash: x", useCount: 0, ...rule, ...extra,
});

describe("sameRule", () => {
  it("matches tool and content exactly", () => {
    expect(sameRule(bash("pnpm test *"), bash("pnpm test *"))).toBe(true);
    expect(sameRule(bash("pnpm test *"), bash("pnpm test:*"))).toBe(false);
    expect(sameRule(bash("pnpm test *"), bash("pnpm test"))).toBe(false);
    expect(sameRule(bash("x"), { toolName: "Read", ruleContent: "x" })).toBe(false);
    expect(sameRule({ toolName: "Read" }, { toolName: "Read", ruleContent: "" })).toBe(true);
  });
});

describe("matchGrants", () => {
  const test = grant(bash("pnpm test *"));
  const build = grant(bash("pnpm build"));

  it("answers when every suggested rule for the tool has a grant", () => {
    expect(matchGrants("Bash", [bash("pnpm test *")], none, [build, test])).toEqual([test]);
    expect(matchGrants("Bash", [bash("pnpm test *"), bash("pnpm build")], none, [build, test])).toEqual([test, build]);
  });

  it("ignores suggestions for other tools, as the run's rules do", () => {
    expect(matchGrants("Bash", [bash("pnpm test *"), { toolName: "Read", ruleContent: "//tmp/**" }], none, [test])).toEqual([test]);
  });

  it("asks when one rule is not covered or only nearly", () => {
    expect(matchGrants("Bash", [bash("pnpm test *"), bash("rm -rf *")], none, [test])).toBeUndefined();
    expect(matchGrants("Bash", [bash("pnpm test:*")], none, [test])).toBeUndefined();
    expect(matchGrants("WebFetch", [{ toolName: "WebFetch", ruleContent: "pnpm test *" }], none, [test])).toBeUndefined();
  });

  it("asks when nothing was suggested", () => {
    expect(matchGrants("Bash", [], none, [test])).toBeUndefined();
    expect(matchGrants("Bash", [{ toolName: "Read", ruleContent: "x" }], none, [test, grant({ toolName: "Read", ruleContent: "x" })])).toBeUndefined();
  });

  it("asks when a suggested rule is blocked, even if the rest is granted", () => {
    expect(matchGrants("Bash", [bash("pnpm test *"), bash("gh pr create *")], none, [test])).toBeUndefined();
    expect(matchGrants("Bash", [bash("pnpm test *"), bash("git push *")], none, [test])).toBeUndefined();
  });

  it("never answers with a blocked grant, even if one is stored", () => {
    for (const c of [undefined, "*", "gh *", "git push *", "git *", "glab:*", "jira *"]) {
      expect(matchGrants("Bash", [bash(c)], none, [grant(bash(c))]), String(c)).toBeUndefined();
    }
  });

  it("ignores revoked grants", () => {
    expect(matchGrants("Bash", [bash("pnpm test *")], none, [{ ...test, revokedAt: "2026-10-04T01:00:00.000Z" }])).toBeUndefined();
  });

  it("asks when a flag wants this call decided by the user", () => {
    expect(matchGrants("Bash", [bash("pnpm test *")], { ...none, suppressAlwaysAllowRule: true }, [test])).toBeUndefined();
    expect(matchGrants("Bash", [bash("pnpm test *")], { ...none, requiresUserInteraction: true }, [test])).toBeUndefined();
  });

  it("never answers a question for the user", () => {
    const rule = { toolName: "AskUserQuestion" };
    expect(matchGrants("AskUserQuestion", [rule], none, [grant(rule)])).toBeUndefined();
  });

  it("covers the sandbox's network ask with a domain grant", () => {
    const domain = { toolName: "WebFetch", ruleContent: "domain:registry.npmjs.org" };
    const g = grant(domain);
    expect(matchGrants("SandboxNetworkAccess", [domain], none, [g])).toEqual([g]);
  });
});

describe("rawRule and repoName", () => {
  it("writes the rule as Claude Code does", () => {
    expect(rawRule(bash("pnpm test *"))).toBe("Bash(pnpm test *)");
    expect(rawRule({ toolName: "Read" })).toBe("Read");
  });

  it("names the repository without its host", () => {
    expect(repoName("github.com/spatie/bloom")).toBe("spatie/bloom");
    expect(repoName("odd")).toBe("odd");
  });
});
