import { describe, expect, it } from "vitest";
import { parseCloneOrigin } from "./clone.js";

describe("parseCloneOrigin", () => {
  it("splits a normalised origin", () => {
    expect(parseCloneOrigin("github.com/spatie/bloom")).toEqual({ host: "github.com", owner: "spatie", repo: "bloom" });
  });

  it("splits an origin on another GitHub host (issue #140)", () => {
    expect(parseCloneOrigin("github.acme.com/team/app")).toEqual({ host: "github.acme.com", owner: "team", repo: "app" });
    expect(parseCloneOrigin("acme.ghe.com/team/app")).toEqual({ host: "acme.ghe.com", owner: "team", repo: "app" });
  });

  it("allows an underscore inside an owner, as managed user accounts have", () => {
    expect(parseCloneOrigin("acme.ghe.com/jdoe_acme/app")?.owner).toBe("jdoe_acme");
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
    "github.com/_x/widgets",
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
