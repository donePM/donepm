import { codeHostContract, type CodeHostScenarios } from "../test-support/contracts/code-host.js";
import { fail, fakeExec, fixture, ok, type FakeCall } from "../test-support/fake-exec.js";
import { fakeHttp, json, status, type FakeRequest } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureDevOpsCodeHost } from "./code-host.js";
import { azureApiTransport, azureCliTransport } from "./transport.js";

const PULLS = "/acme/platform/_apis/git/repositories/legacy/pullrequests";

/** The REST answers of an organization where `legacy` has the open pull request 123. */
function answer(method: string, path: string) {
  if (method === "POST" && path.startsWith(`${PULLS}?`)) return fixture("azure-devops/pr-created.json");
  if (method === "GET" && path.startsWith(`${PULLS}/123?`)) return fixture("azure-devops/pr-active.json");
  return undefined;
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

/** `az rest` answering from the fixtures, as the user's `az login` would. */
function azRest(call: FakeCall) {
  const method = call.args[call.args.indexOf("--method") + 1]!;
  const body = answer(method, pathOf(call.args[call.args.indexOf("--url") + 1]!));
  return body === undefined ? fail("ERROR: Not Found(" + fixture("azure-devops/error-not-found.json") + ")") : ok(body);
}

const gitClone = { "git clone": ok("") };

function rest(request: FakeRequest) {
  const body = answer(request.method, request.path);
  return body === undefined ? json(fixture("azure-devops/error-not-found.json"), 404) : json(body);
}

const shared: Omit<CodeHostScenarios, "answering" | "failing"> = {
  origin: "dev.azure.com/acme/platform/legacy",
  create: { origin: "dev.azure.com/acme/platform/legacy", head: "dp/7-fix-the-build", base: "main", title: "Fix the build on main", body: "Closes AB#7", cwd: "/wt/7" },
  created: { url: "https://dev.azure.com/acme/platform/_git/legacy/pullrequest/123", number: 123 },
  pr: { url: "https://dev.azure.com/acme/Platform/_git/legacy/pullrequest/123", number: 123 },
  statuses: [{ repository: "acme/platform/legacy", number: 5, state: "OPEN" }],
  inReplyTo: 1,
  review: { number: 123, url: "https://dev.azure.com/acme/Platform/_git/legacy/pullrequest/123", commitId: "c0ffee0000000000000000000000000000000000", verdict: "COMMENT", body: "Looks good.", comments: [] },
  unsupported: ["prStatuses", "prFeedback", "reply", "postReview", "merge", "updateBranch"],
};

codeHostContract("Azure DevOps through az", {
  ...shared,
  answering: () => azureDevOpsCodeHost(fakeExec(gitClone), azureCliTransport(fakeExec({ "az rest": azRest }), "acme")),
  failing: () => {
    const exec = fakeExec({ git: fail("fatal: Authentication failed for 'https://dev.azure.com/acme/platform/_git/legacy/'", 128), az: fail("ERROR: Please run 'az login' to setup account.") });
    return azureDevOpsCodeHost(exec, azureCliTransport(exec, "acme"));
  },
});

codeHostContract("Azure DevOps through its REST API", {
  ...shared,
  answering: () => azureDevOpsCodeHost(fakeExec(gitClone), azureApiTransport(fakeHttp({ "POST /acme": rest, "GET /acme": rest }), "acme", memoryTokens({ ado: "pat" }), "ado")),
  failing: () => azureDevOpsCodeHost(
    fakeExec({ git: fail("fatal: Authentication failed", 128) }),
    azureApiTransport(fakeHttp({ "POST /acme": status(401), "GET /acme": status(401) }), "acme", memoryTokens({ ado: "pat" }), "ado"),
  ),
});
