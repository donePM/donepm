import { describe, expect, it } from "vitest";
import type { Ctx } from "../ids.js";
import { collect, externalIdOf, refresh, type SourceIssue } from "./collect.js";
import { NotARepoCandidateError, InvalidTransitionError, repoChosen, RepoNotChosenError, start } from "./transitions.js";
import type { WorkItem } from "./types.js";

function makeCtx(): Ctx {
  let n = 0;
  return { now: () => "2026-10-03T12:00:00.000Z", newId: () => `id-${++n}` };
}

const APP = "github.com/acme/app";
const API = "github.com/acme/api";

const ticket: SourceIssue = {
  repository: "APP",
  number: 123,
  externalId: "jira:APP-123",
  source: "jira-issue",
  url: "https://acme.atlassian.net/browse/APP-123",
  title: "Fix the login",
  body: "It fails.",
  labels: ["Bug", "auth"],
  createdAt: "2026-09-01T08:00:00.000Z",
  priorityTier: 1,
  origins: [APP, API],
};

const ticketItem = (extra: Partial<SourceIssue> = {}, item: Partial<WorkItem> = {}): WorkItem => ({
  ...collect({ ...ticket, ...extra }, makeCtx()).item,
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...item,
});

describe("a collected ticket (issue #139)", () => {
  it("keeps its own id, priority and repositories", () => {
    const { item, events } = collect(ticket, makeCtx());
    expect(externalIdOf(ticket)).toBe("jira:APP-123");
    expect(item).toMatchObject({ source: "jira-issue", externalId: "jira:APP-123", priority: 1, repoCandidates: [APP, API] });
    expect(item).not.toHaveProperty("repoOrigin");
    expect(events[0]!.payload).toEqual({ externalId: "jira:APP-123", url: ticket.url });
  });

  it("goes to its only repository without asking", () => {
    expect(ticketItem({ origins: [APP] })).toMatchObject({ repoCandidates: [APP], repoOrigin: APP });
  });

  it("follows its ticket sources' repositories, keeping a choice still among them", () => {
    const chosen = ticketItem({}, { repoOrigin: API });
    expect(refresh(chosen, ticket, makeCtx())).toBeUndefined();
    const moved = refresh(chosen, { ...ticket, origins: [API, "github.com/acme/web"] }, makeCtx())!;
    expect(moved.item).toMatchObject({ repoCandidates: [API, "github.com/acme/web"], repoOrigin: API });
    expect(moved.events).toEqual([]);
    const dropped = refresh(chosen, { ...ticket, origins: [APP, "github.com/acme/web"] }, makeCtx())!;
    expect(dropped.item).not.toHaveProperty("repoOrigin");
    expect(refresh(chosen, { ...ticket, origins: [APP] }, makeCtx())!.item.repoOrigin).toBe(APP);
  });

  it("keeps the repository the agent started in", () => {
    const started = ticketItem({}, { repoOrigin: API, startedAt: "2026-10-02T00:00:00.000Z" });
    expect(refresh(started, { ...ticket, origins: [APP] }, makeCtx())!.item.repoOrigin).toBe(API);
  });
});

describe("repoChosen", () => {
  it("records the user's choice", () => {
    const t = repoChosen(ticketItem(), makeCtx(), API);
    expect(t.item.repoOrigin).toBe(API);
    expect(t.item.state).toBe("ready");
    expect(t.events).toEqual([
      { id: "id-1", itemId: t.item.id, at: "2026-10-03T12:00:00.000Z", actor: "user", type: "item.repo_chosen", payload: { origin: API } },
    ]);
  });

  it("can change its mind until the agent starts", () => {
    const again = repoChosen(ticketItem({}, { repoOrigin: API }), makeCtx(), APP);
    expect(again.item.repoOrigin).toBe(APP);
    expect(repoChosen(ticketItem({}, { repoOrigin: API }), makeCtx(), API).events).toEqual([]);
    expect(() => repoChosen(ticketItem({}, { repoOrigin: API, startedAt: "2026-10-02T00:00:00.000Z" }), makeCtx(), APP)).toThrow(InvalidTransitionError);
    expect(() => repoChosen(ticketItem({}, { worktreePath: "/w" }), makeCtx(), APP)).toThrow(InvalidTransitionError);
    expect(() => repoChosen(ticketItem({}, { state: "done" }), makeCtx(), APP)).toThrow(InvalidTransitionError);
  });

  it("takes only one of the ticket's repositories", () => {
    expect(() => repoChosen(ticketItem(), makeCtx(), "github.com/acme/other")).toThrow(NotARepoCandidateError);
    const { repoCandidates: _c, ...github } = ticketItem();
    expect(() => repoChosen(github, makeCtx(), APP)).toThrow(NotARepoCandidateError);
  });
});

describe("start of a ticket", () => {
  it("waits for a repository to be chosen", () => {
    expect(() => start(ticketItem(), makeCtx())).toThrow(RepoNotChosenError);
    expect(start(ticketItem({}, { repoOrigin: API }), makeCtx()).item.state).toBe("running");
  });
});
