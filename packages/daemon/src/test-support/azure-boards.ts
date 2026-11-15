import { fail, fakeExec, fixture, ok, type FakeCall } from "./fake-exec.js";
import { fakeHttp, json, type FakeRequest } from "./fake-http.js";

const STATES: Record<string, string> = { bug: "states-bug.json", "user story": "states-user-story.json", task: "states-task.json" };

/**
 * The organization `acme` as Azure Boards answers it (issue #142): its project `Platform` has the
 * open Bug 1234 and User Story 1240, and Task 1250 in `Shipped`, a finished state of a custom
 * process. Undefined for anything else, which the fakes answer as not found.
 */
export function boardsAnswer(method: string, url: string, body: unknown): string | undefined {
  const { pathname } = new URL(url, "https://dev.azure.com");
  const path = decodeURIComponent(pathname).toLowerCase();
  if (method === "POST" && /^\/acme\/(platform\/)?_apis\/wit\/wiql$/.test(path)) {
    const query = (body as { query?: string } | undefined)?.query ?? "";
    return fixture(/\bFROM\s+WorkItemLinks\b/i.test(query) ? "azure-devops/boards/wiql-tree.json" : "azure-devops/boards/wiql.json");
  }
  if (method === "POST" && path === "/acme/_apis/wit/workitemsbatch") {
    const fields = (body as { fields?: string[] } | undefined)?.fields ?? [];
    return fixture(fields.includes("System.Title") ? "azure-devops/boards/workitemsbatch.json" : "azure-devops/boards/workitemsbatch-states.json");
  }
  const states = /^\/acme\/platform\/_apis\/wit\/workitemtypes\/([^/]+)\/states$/.exec(path);
  if (method === "GET" && states && STATES[states[1]!]) return fixture(`azure-devops/boards/${STATES[states[1]!]}`);
  if (method === "GET" && path === "/acme/_apis/connectiondata") return fixture("azure-devops/connection-data.json");
  if (method === "PATCH" && path === "/acme/_apis/wit/workitems/1234") return fixture("azure-devops/boards/workitem-updated.json");
  if (method === "POST" && path === "/acme/platform/_apis/wit/workitems/1234/comments") return fixture("azure-devops/boards/comment-created.json");
  return undefined;
}

/** The REST API of `acme`, as a PAT would see it. */
export function boardsHttp() {
  const answer = (r: FakeRequest) => {
    const body = boardsAnswer(r.method, r.path, r.body);
    return body === undefined ? json(fixture("azure-devops/error-not-found.json"), 404) : json(body);
  };
  return fakeHttp({ "GET /acme": answer, "POST /acme": answer, "PATCH /acme": answer });
}

/** `az rest` against `acme`, as the user's `az login` would. */
export function boardsAz() {
  return fakeExec({
    "az rest": (call: FakeCall) => {
      const arg = (name: string) => {
        const i = call.args.indexOf(name);
        return i < 0 ? undefined : call.args[i + 1];
      };
      const raw = arg("--body");
      const body = boardsAnswer(arg("--method")!, arg("--url")!, raw === undefined ? undefined : JSON.parse(raw));
      return body === undefined ? fail(`ERROR: Not Found(${fixture("azure-devops/error-not-found.json")})`) : ok(body);
    },
  });
}

/** The requests made, as `METHOD path` without the query. */
export const requestLines = (requests: readonly FakeRequest[]) => requests.map((r) => `${r.method} ${r.path.split("?")[0]}`);
