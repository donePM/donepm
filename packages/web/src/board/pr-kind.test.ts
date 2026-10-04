import { describe, expect, it } from "vitest";
import { prKind } from "./pr-kind";

describe("prKind (D47)", () => {
  it("names the author of a pull request, without a bot's suffix", () => {
    expect(prKind({ source: "github-pr", author: "dependabot[bot]" })?.text).toBe("PR · dependabot");
    expect(prKind({ source: "github-pr", author: "octo" })?.text).toBe("PR · octo");
  });

  it("says PR when the author is not known, nothing for an issue", () => {
    expect(prKind({ source: "github-pr" })?.text).toBe("PR");
    expect(prKind({ source: "github-issue" })).toBeUndefined();
  });
});
