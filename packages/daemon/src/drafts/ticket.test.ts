import { describe, expect, it } from "vitest";
import type { ResumeHow } from "../agent/start.js";
import type { JiraConnectionConfig } from "../config/connections.js";
import { jiraConnection } from "../jira/connection.js";
import { providerRegistry } from "../providers/registry.js";
import { draftStores } from "../test-support/draft-stores.js";
import { fakeExec, fixture } from "../test-support/fake-exec.js";
import { fakeHttp, json, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { DraftError, rejectionMessage } from "./actions.js";
import { approveDraft, ExecutionError } from "./execute.js";
import { createTicketCommentDraft, createTicketTransitionDraft, pickTransition, transitionList } from "./ticket.js";

const cloud: JiraConnectionConfig = { id: "jira", kind: "jira", backend: "api", baseUrl: "https://acme.atlassian.net", deployment: "cloud", email: "dana@acme.com" };
const TRANSITIONS = "GET /rest/api/3/issue/APP-123/transitions";

/** `item-1` as the running Jira ticket APP-123. */
function setup(routes: Parameters<typeof fakeHttp>[0] = {}) {
  const t = draftStores();
  const item = t.items.get("item-1")!.item;
  t.items.update({
    ...item, source: "jira-issue", externalId: "jira:APP-123", externalUrl: "https://acme.atlassian.net/browse/APP-123",
    repoCandidates: ["github.com/o/r"], repoOrigin: "github.com/o/r",
  });
  // An item's external id never changes once stored; this one was a ticket from the start.
  t.db.prepare("UPDATE items SET external_id = 'jira:APP-123' WHERE id = 'item-1'").run();
  const http = fakeHttp({
    [TRANSITIONS]: json(fixture("jira/cloud-transitions.json")),
    "POST /rest/api/3/issue/APP-123/comment": json({ id: "10500" }, 201),
    "POST /rest/api/3/issue/APP-123/transitions": status(204),
    ...routes,
  });
  const exec = fakeExec({});
  const continued: ResumeHow[] = [];
  const stopped: string[] = [];
  const deps = {
    ...t.deps, exec, providers: providerRegistry([jiraConnection(cloud, http, memoryTokens({ jira: "t" }), () => [])]),
    stopAgent: async (id: string) => void stopped.push(id),
    continueAgent: async (id: string, how: ResumeHow) => {
      continued.push(how);
      t.deps.writer.commit(how.transition(t.items.get(id)!.item, t.deps.ctx));
    },
  };
  return { ...t, http, exec, deps, continued, stopped };
}

const sent = (t: ReturnType<typeof setup>) => t.http.requests.map((r) => `${r.method} ${r.path}`);

describe("createTicketCommentDraft (issue #139)", () => {
  it("stores a pending comment on the item's own ticket and moves the item to needs_you, sending nothing", () => {
    const t = setup();
    const d = createTicketCommentDraft(t.deps, "item-1", { body: " Which browsers count? " });
    expect(t.drafts.get(d.id)).toEqual({
      id: d.id, itemId: "item-1", type: "ticket_comment", state: "pending",
      payload: { key: "APP-123", url: "https://acme.atlassian.net/browse/APP-123", body: "Which browsers count?" },
    });
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      type: "draft.created", actor: "agent", refId: d.id, payload: { type: "ticket_comment", title: "Comment on APP-123" },
    });
    expect(t.http.requests).toEqual([]);
  });

  it("refuses a GitHub issue", () => {
    const t = draftStores();
    const deps = { ...t.deps, providers: providerRegistry([]) };
    expect(() => createTicketCommentDraft(deps, "item-1", { body: "x" })).toThrow("this item is not a Jira ticket or Azure Boards work item");
    expect(t.state()).toBe("running");
  });

  it("refuses when no connection of that name can write", () => {
    const t = setup();
    expect(() => createTicketCommentDraft({ ...t.deps, providers: providerRegistry([]) }, "item-1", { body: "x" })).toThrow(
      'there is no connection "jira" that can write to the ticket',
    );
  });
});

describe("createTicketTransitionDraft (issue #139)", () => {
  it("checks the move against the transitions Jira offers and stores its id and target status", async () => {
    const t = setup();
    const d = await createTicketTransitionDraft(t.deps, "item-1", { to: "in review", comment: "PR is up." });
    expect(d.payload).toEqual({
      key: "APP-123", url: "https://acme.atlassian.net/browse/APP-123", transitionId: "31", toStatus: "In Review", comment: "PR is up.",
    });
    expect(t.state()).toBe("needs_you");
    expect(t.events.forItem("item-1").at(-1)).toMatchObject({
      type: "draft.created", payload: { type: "ticket_transition", title: "Move APP-123 to In Review, with a comment" },
    });
    // Only the read; nothing changes on Jira before the user approves.
    expect(sent(t)).toEqual([`${TRANSITIONS}?expand=transitions.fields`]);
  });

  it("refuses a move Jira does not offer, naming the ones it does", async () => {
    const t = setup();
    await expect(createTicketTransitionDraft(t.deps, "item-1", { to: "Closed" })).rejects.toThrow(
      'the ticket offers no transition "Closed" now; it offers "21" Start progress → In Progress; ' +
        '"31" Ready for review → In Review; "41" Done → Done (needs Resolution)',
    );
    expect(t.state()).toBe("running");
    expect(t.drafts.forItem("item-1")).toEqual([]);
  });

  it("refuses a move that needs fields donePM cannot fill", async () => {
    const t = setup();
    await expect(createTicketTransitionDraft(t.deps, "item-1", { to: "41" })).rejects.toThrow(
      'the transition "Done" needs fields donePM cannot fill (Resolution)',
    );
    expect(t.state()).toBe("running");
  });

  it("says so when Jira cannot list the transitions", async () => {
    const t = setup({ [TRANSITIONS]: json({ errorMessages: ["Issue does not exist or you do not have permission to see it."] }, 404) });
    const err = await createTicketTransitionDraft(t.deps, "item-1", { to: "21" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftError);
    expect((err as Error).message).toMatch(/^cannot read the ticket's transitions: /);
    expect(t.state()).toBe("running");
  });
});

describe("pickTransition", () => {
  const offered = [
    { id: "21", name: "Start progress", toStatus: "In Progress", requiredFields: [] },
    { id: "31", name: "Review", toStatus: "In Review", requiredFields: [] },
  ];
  it("matches the id first, then the name, then the target status, ignoring case", () => {
    expect(pickTransition(offered, " 31 ").id).toBe("31");
    expect(pickTransition(offered, "start PROGRESS").id).toBe("21");
    expect(pickTransition(offered, "in review").id).toBe("31");
  });
  it("lists none when the workflow offers nothing", () => {
    expect(transitionList([])).toBe("none");
    expect(() => pickTransition([], "Done")).toThrow('offers no transition "Done" now; it offers none');
  });
});

describe("approving a ticket draft", () => {
  it("posts the comment as the user, in Atlassian Document Format, then lets the agent go on", async () => {
    const t = setup();
    const d = createTicketCommentDraft(t.deps, "item-1", { body: "**Done** with the first part." });
    const done = await approveDraft(t.deps, d.id);
    const posts = t.http.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.path)).toEqual(["/rest/api/3/issue/APP-123/comment"]);
    expect(posts[0]!.body).toMatchObject({ body: { type: "doc", version: 1 } });
    expect(JSON.stringify(posts[0]!.body)).toContain('"marks":[{"type":"strong"}]');
    const result = { id: "10500", url: "https://acme.atlassian.net/browse/APP-123?focusedCommentId=10500" };
    expect(done).toMatchObject({ state: "executed", result });
    expect(t.drafts.get(d.id)).toMatchObject({ state: "executed", result });
    expect(t.stopped).toEqual([]);
    expect(t.continued.map((c) => c.prompt)).toEqual([
      "The user approved your ticket draft and donePM did it: Comment on APP-123. Go on with your work.",
    ]);
    expect(t.state()).toBe("running");
    expect(t.types().slice(-2)).toEqual(["draft.approved", "draft.executed"]);
  });

  it("moves the ticket with its comment in one call", async () => {
    const t = setup();
    const d = await createTicketTransitionDraft(t.deps, "item-1", { to: "31", comment: "PR is up." });
    const done = await approveDraft(t.deps, d.id);
    const posts = t.http.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.path)).toEqual(["/rest/api/3/issue/APP-123/transitions"]);
    expect(posts[0]!.body).toMatchObject({ transition: { id: "31" }, update: { comment: [{ add: { body: { type: "doc" } } }] } });
    expect(done).toMatchObject({ state: "executed", result: { status: "In Review" } });
    expect(t.state()).toBe("running");
  });

  it("marks the draft failed and keeps the item with the user when Jira refuses", async () => {
    const t = setup({
      "POST /rest/api/3/issue/APP-123/transitions": json({ errorMessages: ["Transition id '31' is not valid for this issue."] }, 400),
    });
    const d = await createTicketTransitionDraft(t.deps, "item-1", { to: "31" });
    const err = await approveDraft(t.deps, d.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutionError);
    expect((err as ExecutionError).step).toBe("ticket");
    expect((err as ExecutionError).message).toMatch(/^moving APP-123 failed: /);
    expect(t.drafts.get(d.id)!.state).toBe("failed");
    expect(t.continued).toEqual([]);
    expect(t.state()).toBe("needs_you");
  });

  it("tells the agent what a rejected move means", () => {
    expect(rejectionMessage("Too early", "ticket_transition")).toBe(
      "The user rejected your ticket transition.\n\nTheir reason:\nToo early\n\n" +
        "The ticket stays where it is. Go on with your work; call draft_ticket_transition again only if their reason asks for another move.",
    );
  });
});
