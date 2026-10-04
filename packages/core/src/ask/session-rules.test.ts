import { describe, expect, it } from "vitest";
import { askFlags, sessionRules } from "./session-rules.js";

const none = { suppressAlwaysAllowRule: false, requiresUserInteraction: false };
const bash = (ruleContent: string) => ({ toolName: "Bash", ruleContent });
const read = { toolName: "Read", ruleContent: "//tmp/**" };
const domain = { toolName: "WebFetch", ruleContent: "domain:github.com" };

describe("sessionRules", () => {
  it("keeps only the rules for the asked tool", () => {
    expect(sessionRules("Bash", [bash("bin/test:*"), read], none)).toEqual([bash("bin/test:*")]);
    expect(sessionRules("Read", [bash("bin/test:*"), read], none)).toEqual([read]);
    expect(sessionRules("WebFetch", [domain, bash("curl *")], none)).toEqual([domain]);
  });

  it("keeps the domain rule for the sandbox's network ask", () => {
    expect(sessionRules("SandboxNetworkAccess", [domain, { toolName: "WebFetch", ruleContent: "https://x.org/*" }, bash("curl *")], none)).toEqual([domain]);
  });

  it("applies the block list after the tool match", () => {
    expect(sessionRules("Bash", [bash("gh *"), bash("git push *"), bash("pnpm test"), read], none)).toEqual([bash("pnpm test")]);
  });

  it("offers nothing when either flag is set", () => {
    expect(sessionRules("Bash", [bash("pnpm test")], { ...none, suppressAlwaysAllowRule: true })).toEqual([]);
    expect(sessionRules("Bash", [bash("pnpm test")], { ...none, requiresUserInteraction: true })).toEqual([]);
  });
});

describe("askFlags", () => {
  it("reads both flags", () => {
    expect(askFlags({ suppress_always_allow_rule: true, requires_user_interaction: true })).toEqual({
      suppressAlwaysAllowRule: true,
      requiresUserInteraction: true,
    });
  });

  it("treats missing, unknown or non-true values as false", () => {
    expect(askFlags({})).toEqual(none);
    expect(askFlags(undefined)).toEqual(none);
    expect(askFlags("x")).toEqual(none);
    expect(askFlags({ suppress_always_allow_rule: "true", requires_user_interaction: 1, other: true })).toEqual(none);
  });
});
