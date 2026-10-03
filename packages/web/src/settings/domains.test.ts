import { describe, expect, it } from "vitest";
import { formatDomains, parseDomains } from "./domains";

describe("parseDomains", () => {
  it("reads one host per line, lower case, without blanks or duplicates", () => {
    expect(parseDomains(" GitHub.com\n\nnodejs.org, github.com\n")).toEqual(["github.com", "nodejs.org"]);
  });

  it("is empty for an empty field", () => {
    expect(parseDomains("  \n")).toEqual([]);
  });

  it("round-trips with formatDomains", () => {
    expect(parseDomains(formatDomains(["a.org", "b.io"]))).toEqual(["a.org", "b.io"]);
  });
});
