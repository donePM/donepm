import { describe, expect, it } from "vitest";
import { branchName } from "../branch/naming.js";
import { isTicketKey, jiraPriorityTier, parseTicketId, prTitleFor, splitTicketKey, ticketExternalId, workRef } from "./ticket.js";

describe("ticket ids", () => {
  it("prefixes the key with its connection", () => {
    expect(ticketExternalId("jira", "APP-123")).toBe("jira:APP-123");
    expect(parseTicketId("jira:APP-123")).toEqual({ connection: "jira", key: "APP-123" });
    expect(parseTicketId("jira-2:OPS_2-7")).toEqual({ connection: "jira-2", key: "OPS_2-7" });
  });

  it("is never a GitHub id", () => {
    expect(parseTicketId("owner/repo#12")).toBeUndefined();
    expect(parseTicketId("github.acme.com/team/app#12")).toBeUndefined();
    expect(parseTicketId("jira:APP")).toBeUndefined();
    expect(parseTicketId("Jira:APP-1")).toBeUndefined();
  });

  it("knows a key", () => {
    expect(isTicketKey("APP-1")).toBe(true);
    expect(isTicketKey("1-APP")).toBe(false);
    expect(splitTicketKey("OPS_2-17")).toEqual({ project: "OPS_2", number: 17 });
  });
});

describe("jiraPriorityTier", () => {
  it.each([
    ["Highest", 0], ["Blocker", 0],
    ["High", 1], ["Critical", 1],
    ["Medium", 2], ["Major", 2],
    ["Low", 3], ["Lowest", 3], ["Minor", 3], ["Trivial", 3],
    [" lowest ", 3],
  ] as const)("%s is %i", (name, tier) => expect(jiraPriorityTier(name)).toBe(tier));

  it("makes any other priority, or none, a 2", () => {
    expect(jiraPriorityTier("Needs triage")).toBe(2);
    expect(jiraPriorityTier(undefined)).toBe(2);
  });
});

describe("naming work after a ticket", () => {
  it("names a branch by the key", () => {
    expect(workRef("jira:APP-123")).toBe("APP-123");
    expect(workRef("owner/repo#12")).toBe("12");
    expect(workRef("nonsense")).toBeUndefined();
    expect(branchName({ prefix: "dp/", issueNumber: workRef("jira:APP-123")!, title: "Fix the login" })).toBe("dp/APP-123-fix-the-login");
  });

  it("starts a PR title with the key, once", () => {
    expect(prTitleFor("jira:APP-123", "Fix the login")).toBe("APP-123 Fix the login");
    expect(prTitleFor("jira:APP-123", "APP-123: Fix the login")).toBe("APP-123: Fix the login");
    expect(prTitleFor("jira:APP-123", "[app-123] Fix the login")).toBe("[app-123] Fix the login");
    expect(prTitleFor("jira:APP-12", "APP-123 is not this one")).toBe("APP-12 APP-123 is not this one");
  });

  it("leaves a GitHub issue's PR title alone", () => {
    expect(prTitleFor("owner/repo#12", "Fix the login")).toBe("Fix the login");
  });
});
