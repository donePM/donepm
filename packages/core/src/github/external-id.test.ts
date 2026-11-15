import { describe, expect, it } from "vitest";
import { externalIdOf } from "../item/collect.js";
import { parseExternalId } from "./external-id.js";

describe("parseExternalId", () => {
  it("reads a github.com id", () => {
    expect(parseExternalId("Acme/API#12")).toEqual({ host: "github.com", repository: "Acme/API", number: 12, repo: "Acme/API" });
  });

  it("reads the host of any other GitHub (issue #140)", () => {
    expect(parseExternalId("github.acme.com/team/app#7")).toEqual({
      host: "github.acme.com", repository: "team/app", number: 7, repo: "github.acme.com/team/app",
    });
    expect(parseExternalId("acme.ghe.com/team/app#3")?.repo).toBe("acme.ghe.com/team/app");
  });

  it("round-trips externalIdOf", () => {
    const issue = { repository: "team/app", number: 9, url: "https://github.acme.com/team/app/issues/9" };
    expect(parseExternalId(externalIdOf(issue))).toMatchObject({ host: "github.acme.com", repository: "team/app", number: 9 });
  });

  it.each(["owner#1", "owner/repo", "owner/repo#x", "a/b/c/d#1", "owner/repo#1 ", ""])("rejects %j", (id) => {
    expect(parseExternalId(id)).toBeUndefined();
  });
});
