import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fakeHttp, json } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureDevOpsCodeHost } from "./code-host.js";
import { azureApiTransport } from "./transport.js";

const PR = { url: "https://dev.azure.com/acme/My%20Project/_git/old%20app/pullrequest/123", number: 123 };
const PULLS = "/acme/my%20project/_apis/git/repositories/old%20app/pullrequests";

function host(routes: Parameters<typeof fakeHttp>[0], exec = fakeExec({})) {
  const http = fakeHttp(routes);
  return { http, exec, host: azureDevOpsCodeHost(exec, azureApiTransport(http, "acme", memoryTokens({ ado: "pat" }), "ado")) };
}

describe("azureDevOpsCodeHost (issue #141)", () => {
  it("clones over HTTPS with git, never prompting for a login", async () => {
    const exec = fakeExec({ "git clone": ok("") });
    const { host: ado } = host({}, exec);
    expect(await ado.clone("dev.azure.com/acme/my project/old app", "/repos/dev.azure.com/acme/my project/old app")).toEqual({ ok: true });
    expect(exec.calls[0]!.args).toEqual(["clone", "--", "https://dev.azure.com/acme/my%20project/_git/old%20app", "/repos/dev.azure.com/acme/my project/old app"]);
    expect(exec.calls[0]!.opts?.env).toEqual({ GIT_TERMINAL_PROMPT: "0" });
  });

  it("passes git's reason on when a clone fails, and clones nothing that is not Azure DevOps", async () => {
    const exec = fakeExec({ "git clone": fail("Cloning into 'legacy'...\nfatal: repository not found", 128) });
    const { host: ado } = host({}, exec);
    expect(await ado.clone("dev.azure.com/acme/platform/legacy", "/tmp/x")).toEqual({ ok: false, error: "Cloning into 'legacy'...\nfatal: repository not found" });
    expect((await ado.clone("github.com/acme/legacy", "/tmp/x")).ok).toBe(false);
    expect(exec.calls).toHaveLength(1);
  });

  it("opens a pull request from the pushed branch and names it by its web URL", async () => {
    const { host: ado, http } = host({ [`POST ${PULLS}`]: json(fixture("azure-devops/pr-created.json"), 201) });
    const r = await ado.createPr({ origin: "dev.azure.com/acme/my project/old app", head: "dp/7-fix", base: "main", title: "Fix", body: "Closes AB#7", cwd: "/wt" });
    expect(r).toEqual({ ok: true, pr: { url: "https://dev.azure.com/acme/my%20project/_git/old%20app/pullrequest/123", number: 123 } });
    expect(http.requests[0]).toMatchObject({
      method: "POST",
      path: `${PULLS}?api-version=7.1`,
      body: { sourceRefName: "refs/heads/dp/7-fix", targetRefName: "refs/heads/main", title: "Fix", description: "Closes AB#7" },
    });
  });

  it("shortens a description longer than Azure Repos takes", async () => {
    const { host: ado, http } = host({ [`POST ${PULLS}`]: json(fixture("azure-devops/pr-created.json"), 201) });
    await ado.createPr({ origin: "dev.azure.com/acme/my project/old app", head: "h", base: "main", title: "T", body: "x".repeat(6000), cwd: "/wt" });
    expect((http.requests[0]!.body as { description: string }).description).toHaveLength(4000);
  });

  it.each([
    ["pr-active.json", { ok: true, state: "OPEN", mergedAt: null, mergeable: "MERGEABLE", baseRefName: "main" }],
    ["pr-conflicts.json", { ok: true, state: "OPEN", mergedAt: null, mergeable: "CONFLICTING", baseRefName: "main" }],
    ["pr-completed.json", { ok: true, state: "MERGED", mergedAt: "2026-10-01T08:30:00.000Z", mergeable: "MERGEABLE", baseRefName: "main" }],
  ])("reads where a pull request stands from %s", async (name, expected) => {
    const { host: ado } = host({ [`GET ${PULLS}/123`]: json(fixture(`azure-devops/${name}`)) });
    expect(await ado.prState(PR)).toEqual(expected);
  });

  it("reports a pull request it cannot read, with Azure DevOps' reason", async () => {
    const { host: ado } = host({ [`GET ${PULLS}/123`]: json(fixture("azure-devops/error-not-found.json"), 404) });
    const r = await ado.prState(PR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Azure DevOps: TF401019: .*\(HTTP 404\)$/);
    expect((await ado.prState({ url: "https://github.com/acme/legacy/pull/1", number: 1 })).ok).toBe(false);
  });
});
