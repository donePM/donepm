import { describe, expect, it } from "vitest";
import { parseCloneOrigin } from "./clone.js";

describe("parseCloneOrigin", () => {
  it("splits a normalised origin", () => {
    expect(parseCloneOrigin("github.com/spatie/bloom")).toEqual({ host: "github.com", owner: "spatie", repo: "bloom" });
  });

  it("allows dots, underscores and a leading dot in the repository name", () => {
    expect(parseCloneOrigin("github.com/acme/.github")?.repo).toBe(".github");
    expect(parseCloneOrigin("github.com/acme/my_repo.js")?.repo).toBe("my_repo.js");
  });

  it.each([
    "github.com/acme",
    "github.com/acme/widgets/extra",
    "github.com/../widgets",
    "github.com/acme/..",
    "github.com/acme/.",
    "github.com/acme/wid gets",
    "github.com/acme/wid\\gets",
    "github.com/-x/widgets",
    "github.com/acme/-widgets",
    "github.com/ac.me/widgets",
    "github.com//widgets",
    "GitHub.com/Acme/Widgets",
    "https://github.com/acme/widgets",
    "github.com/acme/widgets.git",
    "",
  ])("rejects %j", (origin) => {
    expect(parseCloneOrigin(origin)).toBeUndefined();
  });
});
