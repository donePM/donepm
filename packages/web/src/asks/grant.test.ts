import { describe, expect, it } from "vitest";
import { grantText, grantWords } from "./grant";

const rules = [
  { toolName: "WebFetch", ruleContent: "domain:api.github.com" },
  { toolName: "Bash", ruleContent: "bin/test:*" },
  { toolName: "Bash", ruleContent: "bin/test *" },
];

describe("grantText", () => {
  it("names each rule once, in plain words", () => {
    expect(grantText(rules)).toBe("web and network access to api.github.com, Bash commands matching bin/test *");
  });

  it("is undefined without rules", () => {
    expect(grantText([])).toBeUndefined();
  });
});

describe("grantWords", () => {
  it("splits each rule once into words and pattern", () => {
    expect(grantWords(rules)).toEqual([
      { text: "web and network access to", pattern: "api.github.com" },
      { text: "Bash commands matching", pattern: "bin/test *" },
    ]);
    expect(grantWords([])).toEqual([]);
  });
});
