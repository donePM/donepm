import type { ResumeHow } from "../agent/start.js";
import { describe, expect, it } from "vitest";
import { approveDraft } from "../drafts/execute.js";
import { createTicketCommentDraft, createTicketTransitionDraft } from "../drafts/ticket.js";
import { providerRegistry } from "../providers/registry.js";
import { boardsHttp, requestLines } from "../test-support/azure-boards.js";
import { draftStores } from "../test-support/draft-stores.js";
import { fakeExec } from "../test-support/fake-exec.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureDevOpsConnection } from "./connection.js";

const URL_1234 = "https://dev.azure.com/acme/Platform/_workitems/edit/1234";

/** `item-1` as the running Azure Boards work item 1234, worked in a GitHub repository. */
function setup() {
  const t = draftStores({ source: "ado-work-item", externalId: "ado:1234", externalUrl: URL_1234, repoCandidates: ["github.com/o/r"], repoOrigin: "github.com/o/r" });
  const http = boardsHttp();
  const ado = azureDevOpsConnection({ id: "ado", organization: "acme", backend: "api", exec: fakeExec({}), http, tokens: memoryTokens({ ado: "pat" }), ticketSources: () => [] });
  const continued: ResumeHow[] = [];
  const deps = {
    ...t.deps, exec: fakeExec({}), providers: providerRegistry([ado]),
    stopAgent: async () => {},
    continueAgent: async (id: string, how: ResumeHow) => {
      continued.push(how);
      t.deps.writer.commit(how.transition(t.items.get(id)!.item, t.deps.ctx));
    },
  };
  return { ...t, http, deps, continued };
}

describe("ticket drafts on an Azure Boards work item (issue #142)", () => {
  it("offers the other states of the work item's type as moves and stores the chosen one", async () => {
    const t = setup();
    const d = await createTicketTransitionDraft(t.deps, "item-1", { to: "resolved", comment: "PR is up." });
    expect(d.payload).toEqual({ key: "1234", url: URL_1234, transitionId: "Resolved", toStatus: "Resolved", comment: "PR is up." });
    expect(t.http.requests.some((r) => r.method !== "GET" && !r.path.includes("workitemsbatch"))).toBe(false);
    expect(t.state()).toBe("needs_you");
  });

  it("moves the work item, then posts the comment, only after approval", async () => {
    const t = setup();
    const d = await createTicketTransitionDraft(t.deps, "item-1", { to: "Resolved", comment: "PR is up." });
    const before = t.http.requests.length;
    const done = await approveDraft(t.deps, d.id);
    const writes = t.http.requests.slice(before).filter((r) => r.method === "PATCH" || r.path.includes("/comments"));
    expect(requestLines(writes)).toEqual(["PATCH /acme/_apis/wit/workitems/1234", "POST /acme/Platform/_apis/wit/workItems/1234/comments"]);
    expect(writes[0]!.body).toEqual([{ op: "add", path: "/fields/System.State", value: "Resolved" }]);
    expect(writes[1]!.body).toEqual({ text: "PR is up." });
    expect(done).toMatchObject({ state: "executed" });
    expect(t.state()).toBe("running");
  });

  it("posts an approved comment in Markdown", async () => {
    const t = setup();
    const d = createTicketCommentDraft(t.deps, "item-1", { body: "Which browsers count?" });
    expect(t.http.requests).toEqual([]);
    const done = await approveDraft(t.deps, d.id);
    const post = t.http.requests.find((r) => r.path.includes("/comments"))!;
    expect(post.path).toContain("format=markdown");
    expect(post.body).toEqual({ text: "Which browsers count?" });
    expect(done).toMatchObject({ state: "executed", result: { url: URL_1234 } });
  });
});
