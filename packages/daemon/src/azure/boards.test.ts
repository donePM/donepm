import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_WIQL, DEFAULT_WIQL, type TicketSourceConfig } from "../config/ticket-sources.js";
import { boardsAz, boardsHttp, requestLines } from "../test-support/azure-boards.js";
import { fixture } from "../test-support/fake-exec.js";
import { fakeHttp, json } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureBoards } from "./boards.js";
import { azureApiTransport, azureCliTransport } from "./transport.js";

const WIDGETS = "github.com/acme/widgets";
const LEGACY = "dev.azure.com/acme/platform/legacy";
const board = { id: "ado", organization: "acme" };

function source(entries: TicketSourceConfig[] = [{ connection: "ado", project: "Platform", repos: [WIDGETS] }], http = boardsHttp()) {
  return { http, boards: azureBoards(azureApiTransport(http, "acme", memoryTokens({ ado: "pat" }), "ado"), board, () => entries) };
}

const ref = (externalId: string) => ({ externalId, origin: WIDGETS });

describe("azureBoards collect (issue #142)", () => {
  it("reads a work item as a ticket: Markdown body with its sections, tags and type as labels, priority tier", async () => {
    const [search] = await source().boards.collect(() => []);
    expect(search!.result.ok).toBe(true);
    if (!search!.result.ok) return;
    const [bug, story] = search!.result.issues;
    expect(bug).toEqual({
      repository: "Platform",
      number: 1234,
      externalId: "ado:1234",
      source: "ado-work-item",
      url: "https://dev.azure.com/acme/Platform/_workitems/edit/1234",
      title: "Login fails after a password reset",
      body: "Users who reset their password are sent back to the **login page**.\n\n## Repro steps\n\n1.  Reset the password\n2.  Sign in with the new one",
      labels: ["auth", "regression", "Bug"],
      createdAt: "2026-09-21T09:30:12.417Z",
      priorityTier: 0,
      origins: [WIDGETS],
    });
    expect(story).toMatchObject({ number: 1240, labels: ["User Story"], priorityTier: 2 });
    expect(story!.body).toContain("## Acceptance criteria\n\n-   One row per card");
  });

  it("runs the default query in the entry's project, reads every work item in one batch and leaves finished ones out", async () => {
    const { boards, http } = source();
    const [search] = await boards.collect(() => []);
    expect(requestLines(http.requests)).toEqual([
      "POST /acme/Platform/_apis/wit/wiql",
      "POST /acme/_apis/wit/workitemsbatch",
      "GET /acme/Platform/_apis/wit/workitemtypes/Bug/states",
      "GET /acme/Platform/_apis/wit/workitemtypes/User%20Story/states",
      "GET /acme/Platform/_apis/wit/workitemtypes/Task/states",
    ]);
    expect(http.requests[0]!.body).toEqual({ query: DEFAULT_PROJECT_WIQL });
    expect(http.requests[0]!.path).toContain("%24top=200");
    expect(http.requests[1]!.body).toMatchObject({ ids: [1234, 1240, 1250], errorPolicy: "omit" });
    expect(search!.result.ok && search!.result.issues.map((i) => i.number)).toEqual([1234, 1240]);
  });

  it("sends a work item several entries find to all their repositories, and labels all but the first search", async () => {
    const { boards, http } = source([
      { connection: "ado", project: "Platform", repos: [WIDGETS] },
      { connection: "ado", repos: [LEGACY] },
      { connection: "other", repos: ["github.com/acme/other"] },
    ]);
    const searches = await boards.collect(() => []);
    expect(searches.map((s) => s.label)).toEqual([undefined, `Azure Boards "${DEFAULT_WIQL.slice(0, 63)}…"`]);
    expect(http.requests[1]!.body).toEqual({ query: DEFAULT_WIQL });
    expect(requestLines(http.requests).slice(0, 3)).toEqual(["POST /acme/Platform/_apis/wit/wiql", "POST /acme/_apis/wit/wiql", "POST /acme/_apis/wit/workitemsbatch"]);
    for (const s of searches) expect(s.result.ok && s.result.issues.map((i) => i.origins)).toEqual([[WIDGETS, LEGACY], [WIDGETS, LEGACY]]);
  });

  it("asks the states of a work item type once", async () => {
    const { boards, http } = source();
    await boards.collect(() => []);
    await boards.collect(() => []);
    expect(requestLines(http.requests).filter((l) => l.endsWith("/states"))).toHaveLength(3);
  });

  it("collects nothing without an entry of its own", async () => {
    const { boards, http } = source([{ connection: "other", repos: [WIDGETS] }]);
    expect(await boards.collect(() => [])).toEqual([]);
    expect(http.requests).toHaveLength(0);
  });

  it("keeps a work item open when its state's category cannot be read", async () => {
    const http = fakeHttp({
      "POST /acme/Platform/_apis/wit/wiql": json(fixture("azure-devops/boards/wiql.json")),
      "POST /acme/_apis/wit/workitemsbatch": json(fixture("azure-devops/boards/workitemsbatch.json")),
    });
    const [search] = await source(undefined, http).boards.collect(() => []);
    expect(search!.result.ok && search!.result.issues.map((i) => i.number)).toEqual([1234, 1240, 1250]);
  });

  it("reports a refused query with Azure DevOps' message", async () => {
    const http = fakeHttp({ "POST /acme/Platform/_apis/wit/wiql": json(fixture("azure-devops/boards/error-wiql.json"), 400) });
    const [search] = await source(undefined, http).boards.collect(() => []);
    expect(search!.result).toEqual({
      ok: false,
      kind: "command",
      error: "Azure DevOps: TF51005: The query references a field that does not exist. The error is caused by «[System.Sprint]». (HTTP 400)",
    });
  });

  it("reports an answer of an unexpected shape as a schema failure with the raw answer", async () => {
    const http = fakeHttp({ "POST /acme/Platform/_apis/wit/wiql": json({ workItems: [{ id: "1234" }] }) });
    const [search] = await source(undefined, http).boards.collect(() => []);
    expect(search!.result).toMatchObject({ ok: false, kind: "schema", raw: '{"workItems":[{"id":"1234"}]}' });
  });

  it("makes no write while it collects and reads states", async () => {
    const { boards, http } = source();
    await boards.collect(() => []);
    await boards.query(LEGACY, "SELECT [System.Id] FROM WorkItems");
    await boards.states!([ref("ado:1234")]);
    expect(http.requests.filter((r) => r.method === "PATCH" || r.path.includes("/comments"))).toEqual([]);
  });
});

describe("azureBoards query", () => {
  it("runs a repository's query in its Azure Repos project, else across the organization", async () => {
    const { boards, http } = source();
    const inProject = await boards.query(LEGACY, "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project");
    await boards.query(WIDGETS, "SELECT [System.Id] FROM WorkItems");
    expect(requestLines(http.requests).filter((l) => l.endsWith("/wiql"))).toEqual(["POST /acme/platform/_apis/wit/wiql", "POST /acme/_apis/wit/wiql"]);
    expect(inProject.ok && inProject.issues[0]!.origins).toEqual([LEGACY]);
  });

  it("reads the targets of a link query", async () => {
    const r = await source().boards.query("", "SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = 1240 MODE (Recursive)");
    expect(r.ok && r.issues.map((i) => [i.number, i.origins])).toEqual([[1240, []], [1234, []]]);
  });
});

describe("azureBoards states", () => {
  it("reads open and finished work items in one batch, by category, and leaves out what it cannot read", async () => {
    const { boards, http } = source();
    const states = await boards.states!([ref("ado:1234"), ref("ado:1250"), ref("ado:1260"), ref("ado:9999"), ref("jira:APP-1"), ref("github.com/acme/widgets#1")]);
    expect(states).toEqual(new Map([["ado:1234", "OPEN"], ["ado:1250", "CLOSED"], ["ado:1260", "CLOSED"]]));
    expect(http.requests[0]!.body).toEqual({ ids: [1234, 1250, 1260, 9999], fields: ["System.Id", "System.TeamProject", "System.WorkItemType", "System.State"], errorPolicy: "omit" });
    expect(requestLines(http.requests).filter((l) => l.endsWith("/workitemsbatch"))).toHaveLength(1);
  });

  it("asks nothing for tickets of other connections", async () => {
    const { boards, http } = source();
    expect(await boards.state(ref("jira:APP-1"))).toBeUndefined();
    expect(http.requests).toHaveLength(0);
  });
});

describe("azureBoards writes, called only after the user's click or approval", () => {
  it("assigns a work item to the signed-in account with a JSON patch", async () => {
    const { boards, http } = source();
    expect(await boards.assignToMe(ref("ado:1234"))).toEqual({ ok: true });
    const patch = http.requests.find((r) => r.method === "PATCH")!;
    expect(patch.path).toBe("/acme/_apis/wit/workitems/1234?api-version=7.1");
    expect(patch.headers["content-type"]).toBe("application/json-patch+json");
    expect(patch.body).toEqual([{ op: "add", path: "/fields/System.AssignedTo", value: "jamal@acme.example" }]);
  });

  it("assigns through az rest the same way", async () => {
    const exec = boardsAz();
    const boards = azureBoards(azureCliTransport(exec, "acme"), board, () => []);
    expect(await boards.assignToMe(ref("ado:1234"))).toEqual({ ok: true });
    const args = exec.calls.at(-1)!.args;
    expect(args).toContain("Content-Type=application/json-patch+json");
    expect(JSON.parse(args[args.indexOf("--body") + 1]!)).toEqual([{ op: "add", path: "/fields/System.AssignedTo", value: "jamal@acme.example" }]);
  });

  it("refuses a ticket of another connection without a call", async () => {
    const { boards, http } = source();
    expect(await boards.assignToMe(ref("jira:APP-1"))).toEqual({ ok: false, error: "jira:APP-1 is not a work item of ado" });
    expect(http.requests).toHaveLength(0);
  });

  it("comments in Markdown in the work item's project", async () => {
    const { boards, http } = source();
    expect(await boards.comment!(ref("ado:1234"), "Fixed in the linked pull request.")).toEqual({
      ok: true,
      id: "5021",
      url: "https://dev.azure.com/acme/Platform/_workitems/edit/1234",
    });
    const post = http.requests.find((r) => r.path.includes("/comments"))!;
    expect(post.path).toBe("/acme/Platform/_apis/wit/workItems/1234/comments?format=markdown&api-version=7.1-preview.4");
    expect(post.body).toEqual({ text: "Fixed in the linked pull request." });
  });

  it("offers the other states of the work item's type as transitions", async () => {
    const r = await source().boards.transitions!(ref("ado:1234"));
    expect(r).toEqual({
      ok: true,
      transitions: ["New", "Resolved", "Closed"].map((s) => ({ id: s, name: s, toStatus: s, requiredFields: [] })),
    });
  });

  it("moves a work item, then comments", async () => {
    const { boards, http } = source();
    expect(await boards.transition!(ref("ado:1234"), "Resolved", "Ready for review.")).toEqual({ ok: true });
    const writes = http.requests.filter((r) => r.method === "PATCH" || r.path.includes("/comments"));
    expect(writes.map((r) => r.body)).toEqual([[{ op: "add", path: "/fields/System.State", value: "Resolved" }], { text: "Ready for review." }]);
  });

  it("says the move happened when only the comment fails", async () => {
    const http = fakeHttp({ "PATCH /acme/_apis/wit/workitems/1234": json(fixture("azure-devops/boards/workitem-updated.json")) });
    const r = await source(undefined, http).boards.transition!(ref("ado:1234"), "Resolved", "Ready for review.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^moved to Resolved, but the comment failed: /);
  });
});
