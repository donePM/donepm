import { describe, expect, it } from "vitest";
import { grantText } from "./grant";

describe("grantText", () => {
  it("names each rule once, in plain words", () => {
    expect(
      grantText([
        { toolName: "WebFetch", ruleContent: "domain:api.github.com" },
        { toolName: "Bash", ruleContent: "curl *" },
        { toolName: "Bash", ruleContent: "curl *" },
      ]),
    ).toBe("web and network access to api.github.com, Bash: curl *");
  });

  it("is undefined without rules", () => {
    expect(grantText([])).toBeUndefined();
  });
});
