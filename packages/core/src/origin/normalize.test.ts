import { describe, expect, it } from "vitest";
import { normalizeOriginUrl } from "./normalize.js";

describe("normalizeOriginUrl", () => {
  it.each([
    ["https://github.com/donePM/donepm", "github.com/donepm/donepm"],
    ["https://github.com/donePM/donepm.git", "github.com/donepm/donepm"],
    ["https://github.com/donePM/donepm/", "github.com/donepm/donepm"],
    ["https://github.com/donePM/donepm.git/", "github.com/donepm/donepm"],
    ["http://github.com/o/r.git", "github.com/o/r"],
    ["git@github.com:o/r.git", "github.com/o/r"],
    ["git@github.com:o/r", "github.com/o/r"],
    ["ssh://git@github.com/o/r.git", "github.com/o/r"],
    ["ssh://git@github.com:22/o/r.git", "github.com/o/r"],
    ["https://user:tok@github.com/o/r.git", "github.com/o/r"],
    ["git://github.com/o/r.git", "github.com/o/r"],
    ["  https://github.com/o/r.git\n", "github.com/o/r"],
    ["github.com/o/r", "github.com/o/r"],
    // GitHub Enterprise Server and GHE.com (issue #140).
    ["https://github.acme.com/team/app.git", "github.acme.com/team/app"],
    ["git@github.acme.com:team/app.git", "github.acme.com/team/app"],
    ["ssh://git@github.acme.com:2222/team/app.git", "github.acme.com/team/app"],
    ["https://acme.ghe.com/Team/App", "acme.ghe.com/team/app"],
    ["git@acme.ghe.com:Team/App.git", "acme.ghe.com/team/app"],
  ])("%s", (input, expected) => {
    expect(normalizeOriginUrl(input)).toBe(expected);
  });

  it("makes all variants equal", () => {
    const variants = ["https://github.com/o/r.git", "git@github.com:o/r.git", "https://github.com/o/r/"];
    expect(new Set(variants.map(normalizeOriginUrl)).size).toBe(1);
  });
});
