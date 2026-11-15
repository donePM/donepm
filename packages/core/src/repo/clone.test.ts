import { describe, expect, it } from "vitest";
import { cloneSegments, parseCloneOrigin } from "./clone.js";

describe("cloneSegments", () => {
  const segments = (origin: string) => cloneSegments(parseCloneOrigin(origin)!);

  it("keeps <owner>/<repo> on github.com, where clones have always been", () => {
    expect(segments("github.com/acme/widgets")).toEqual(["acme", "widgets"]);
  });

  it("puts every other host under a folder of its own, so the same names on two hosts never collide", () => {
    expect(segments("github.acme.com/acme/widgets")).toEqual(["github.acme.com", "acme", "widgets"]);
    expect(segments("dev.azure.com/acme/platform/legacy")).toEqual(["dev.azure.com", "acme", "platform", "legacy"]);
  });
});

describe("parseCloneOrigin", () => {
  it("splits a normalised origin", () => {
    expect(parseCloneOrigin("github.com/spatie/bloom")).toEqual({ host: "github.com", path: ["spatie", "bloom"] });
  });

  it("splits an origin on another GitHub host (issue #140)", () => {
    expect(parseCloneOrigin("github.acme.com/team/app")).toEqual({ host: "github.acme.com", path: ["team", "app"] });
    expect(parseCloneOrigin("acme.ghe.com/team/app")).toEqual({ host: "acme.ghe.com", path: ["team", "app"] });
  });

  it("allows an underscore inside an owner, as managed user accounts have", () => {
    expect(parseCloneOrigin("acme.ghe.com/jdoe_acme/app")?.path[0]).toBe("jdoe_acme");
  });

  it("allows dots, underscores and a leading dot in the repository name", () => {
    expect(parseCloneOrigin("github.com/acme/.github")?.path[1]).toBe(".github");
    expect(parseCloneOrigin("github.com/acme/my_repo.js")?.path[1]).toBe("my_repo.js");
  });

  it("splits an Azure DevOps origin into organization, project and repository (issue #141)", () => {
    expect(parseCloneOrigin("dev.azure.com/acme/my project/legacy")).toEqual({
      host: "dev.azure.com",
      path: ["acme", "my project", "legacy"],
      azure: { organization: "acme", project: "my project", repository: "legacy" },
    });
  });

  it.each([
    "dev.azure.com/acme/platform",
    "dev.azure.com/acme/platform/_git/legacy",
    "dev.azure.com/acme/../legacy",
    "dev.azure.com/acme/platform/-x",
    "dev.azure.com/Acme/Platform/Legacy",
  ])("rejects the Azure DevOps origin %j", (origin) => {
    expect(parseCloneOrigin(origin)).toBeUndefined();
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
