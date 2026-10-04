import { describe, expect, it } from "vitest";
import { describeRule, isRuleOfferable, offerableRules, parseRules, ruleWords } from "./rules.js";

const bash = (ruleContent?: string) => (ruleContent === undefined ? { toolName: "Bash" } : { toolName: "Bash", ruleContent });

describe("describeRule", () => {
  it("says web and network for WebFetch domains", () => {
    expect(describeRule({ toolName: "WebFetch", ruleContent: "domain:github.com" })).toBe("web and network access to github.com");
  });

  it("names the tool and its content", () => {
    expect(describeRule(bash("curl *"))).toBe("Bash commands matching curl *");
    expect(describeRule(bash("bin/test:*"))).toBe("Bash commands matching bin/test *");
    expect(describeRule({ toolName: "WebFetch", ruleContent: "something else" })).toBe("WebFetch calls matching something else");
  });

  it("covers every call for a bare tool", () => {
    expect(describeRule({ toolName: "Read" })).toBe("all Read calls");
    expect(describeRule({ toolName: "Read", ruleContent: "  " })).toBe("all Read calls");
  });
});

describe("ruleWords", () => {
  it("splits the words from the pattern", () => {
    expect(ruleWords(bash("bin/test:*"))).toEqual({ text: "Bash commands matching", pattern: "bin/test *" });
    expect(ruleWords({ toolName: "WebFetch", ruleContent: "domain:github.com" })).toEqual({ text: "web and network access to", pattern: "github.com" });
    expect(ruleWords({ toolName: "Read" })).toEqual({ text: "all Read calls" });
  });
});

describe("isRuleOfferable", () => {
  it("offers ordinary rules", () => {
    expect(isRuleOfferable(bash("curl *"))).toBe(true);
    expect(isRuleOfferable(bash("pnpm test"))).toBe(true);
    expect(isRuleOfferable(bash("npm:*"))).toBe(true);
    expect(isRuleOfferable(bash("ghost *"))).toBe(true);
    expect(isRuleOfferable(bash("git status"))).toBe(true);
    expect(isRuleOfferable(bash("git pull *"))).toBe(true);
    expect(isRuleOfferable({ toolName: "WebFetch", ruleContent: "domain:github.com" })).toBe(true);
    expect(isRuleOfferable({ toolName: "Read" })).toBe(true);
  });

  it("refuses the blocked commands in any spelling", () => {
    for (const c of ["gh *", "gh", "gh:*", "gh pr list", "glab *", "jira *", "gh*", "/opt/homebrew/bin/gh *"]) {
      expect(isRuleOfferable(bash(c)), c).toBe(false);
    }
  });

  it("refuses git push and rules that cover it", () => {
    for (const c of ["git push", "git push *", "git push*", "git *", "git:*", "git p*", "*push", "* push"]) {
      expect(isRuleOfferable(bash(c)), c).toBe(false);
    }
  });

  it("refuses rules that cover every Bash command", () => {
    for (const c of [undefined, "", "*", "**", " * "]) expect(isRuleOfferable(bash(c)), String(c)).toBe(false);
  });

  it("filters a list", () => {
    expect(offerableRules([bash("curl *"), bash("gh *"), { toolName: "WebFetch", ruleContent: "domain:a.com" }])).toEqual([
      bash("curl *"), { toolName: "WebFetch", ruleContent: "domain:a.com" },
    ]);
  });
});

describe("parseRules", () => {
  it("keeps well-formed rules and drops the rest", () => {
    expect(parseRules([{ toolName: "A" }, { toolName: "B", ruleContent: "x" }, { toolName: 1 }, { toolName: "C", ruleContent: 2 }, null, "x", { toolName: "" }])).toEqual([
      { toolName: "A" }, { toolName: "B", ruleContent: "x" },
    ]);
    expect(parseRules("nope")).toEqual([]);
    expect(parseRules(undefined)).toEqual([]);
  });
});
