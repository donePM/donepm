import { describe, expect, it } from "vitest";
import { branchName } from "../branch/naming.js";
import { parseTicketId, prTitleFor, ticketExternalId, ticketLabel, workRef } from "../jira/ticket.js";
import { azurePriorityTier, azureWorkItemUrl, boardsWorkItemOf, isFinishedCategory, withBoardsLink, workItemBody, workItemLabels } from "./work-item.js";

describe("work item ids (issue #142)", () => {
  it("carry the connection and the number", () => {
    expect(ticketExternalId("ado", "1234")).toBe("ado:1234");
    expect(parseTicketId("ado:1234")).toEqual({ connection: "ado", key: "1234" });
    expect(parseTicketId("ado:0")).toBeUndefined();
    expect(parseTicketId("acme/widgets#1234")).toBeUndefined();
  });

  it("show as #1234 on the card, a Jira key as it is", () => {
    expect(ticketLabel({ connection: "ado", key: "1234" })).toBe("#1234");
    expect(ticketLabel({ connection: "jira", key: "APP-1" })).toBe("APP-1");
  });

  it("name the branch by the number and leave the PR title alone", () => {
    expect(workRef("ado:1234")).toBe("1234");
    expect(branchName({ prefix: "dp/", issueNumber: workRef("ado:1234")!, title: "Fix the login" })).toBe("dp/1234-fix-the-login");
    expect(prTitleFor("ado:1234", "Fix the login")).toBe("Fix the login");
    expect(prTitleFor("jira:APP-1", "Fix the login")).toBe("APP-1 Fix the login");
  });
});

describe("azurePriorityTier", () => {
  it.each([
    [1, 0], [2, 1], [3, 2], [4, 3],
    [undefined, 2], [null, 2], [0, 2], [5, 2], [2.5, 2], ["1", 2],
  ])("%j is tier %i", (priority, tier) => {
    expect(azurePriorityTier(priority)).toBe(tier);
  });
});

describe("isFinishedCategory", () => {
  it.each([
    ["Completed", true], ["Removed", true], ["completed", true],
    ["Proposed", false], ["InProgress", false], ["Resolved", false], [undefined, false],
  ])("%s finished: %s", (category, finished) => {
    expect(isFinishedCategory(category)).toBe(finished);
  });
});

describe("workItemLabels", () => {
  it("splits the tags and adds the type", () => {
    expect(workItemLabels("auth; regression;  ", "Bug")).toEqual(["auth", "regression", "Bug"]);
    expect(workItemLabels(undefined, "User Story")).toEqual(["User Story"]);
    expect(workItemLabels("Bug", "Bug")).toEqual(["Bug"]);
    expect(workItemLabels(null, null)).toEqual([]);
  });
});

describe("workItemBody", () => {
  it("puts acceptance criteria and repro steps under headings after the description", () => {
    expect(workItemBody({ description: "Login fails.", acceptanceCriteria: "- works", reproSteps: "1. reset" }))
      .toBe("Login fails.\n\n## Acceptance criteria\n\n- works\n\n## Repro steps\n\n1. reset");
  });

  it("leaves out what is empty", () => {
    expect(workItemBody({ description: "", reproSteps: "1. reset" })).toBe("## Repro steps\n\n1. reset");
    expect(workItemBody({})).toBe("");
  });
});

describe("links", () => {
  it("builds the web URL of a work item", () => {
    expect(azureWorkItemUrl("acme", "Platform Team", 1234)).toBe("https://dev.azure.com/acme/Platform%20Team/_workitems/edit/1234");
  });

  it("adds AB#<n> to a PR description once", () => {
    expect(withBoardsLink("Fixes the login.\n", 1234)).toBe("Fixes the login.\n\nAB#1234");
    expect(withBoardsLink("", 1234)).toBe("AB#1234");
    expect(withBoardsLink("Fixes AB#1234.", 1234)).toBe("Fixes AB#1234.");
    expect(withBoardsLink("Fixes AB#12345.", 1234)).toBe("Fixes AB#12345.\n\nAB#1234");
  });

  it("knows the work item an item was collected from", () => {
    const url = "https://dev.azure.com/acme/Platform/_workitems/edit/1234";
    expect(boardsWorkItemOf({ source: "ado-work-item", externalId: "ado:1234", externalUrl: url })).toEqual({ organization: "acme", id: 1234 });
    expect(boardsWorkItemOf({ source: "jira-issue", externalId: "jira:APP-1", externalUrl: "https://acme.atlassian.net/browse/APP-1" })).toBeUndefined();
    expect(boardsWorkItemOf({ source: "github-issue", externalId: "acme/widgets#1", externalUrl: "https://github.com/acme/widgets/issues/1" })).toBeUndefined();
  });
});
