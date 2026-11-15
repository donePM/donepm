import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fakeHttp, json, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { ciSourceContract } from "../test-support/contracts/ci-source.js";
import { azurePipelines, logTail } from "./pipelines.js";
import { azureApiTransport, azureCliTransport } from "./transport.js";

const PR = { url: "https://dev.azure.com/acme/Platform/_git/legacy/pullrequest/123", number: 123 };
const PROJECT_ID = "0b2d9c3e-5c3f-4a4f-9f0e-6b1f2f7c1a11";
const BUILD = `https://dev.azure.com/acme/${PROJECT_ID}/_build/results?buildId=812`;
const UNIT_JOB = "a1f3c9e2-7b44-5d1e-9c0a-2f6e8b1d4c55";
const BUILDS = `/acme/${PROJECT_ID}/_apis/build/builds/812`;

/** Azure DevOps answering for PR 123 of `platform/legacy` and its build 812; `evaluations` picks the policy fixture. */
function routes(evaluations = "policy-evaluations-fail.json") {
  return {
    "GET /acme/platform/_apis/git/repositories/legacy/pullrequests/123": json(fixture("azure-devops/pr-active.json")),
    "GET /acme/platform/_apis/policy/evaluations": json(fixture(`azure-devops/${evaluations}`)),
    "GET /acme/platform/_apis/build/builds/812/timeline": json(fixture("azure-devops/build-timeline-failed.json")),
    "GET /acme/platform/_apis/build/builds/812/logs/7": status(200, fixture("azure-devops/build-log-tests.txt")),
    "GET /acme/platform/_apis/build/builds/812/logs/9": json(fixture("azure-devops/build-log-lint.json")),
    [`GET ${BUILDS}/timeline`]: json(fixture("azure-devops/build-timeline-failed.json")),
    [`GET ${BUILDS}/logs/7`]: status(200, fixture("azure-devops/build-log-tests.txt")),
    [`GET ${BUILDS}/logs/9`]: json(fixture("azure-devops/build-log-lint.json")),
    [`PATCH ${BUILDS}/stages/build`]: status(204),
    "PATCH /acme/platform/_apis/build/builds/812/stages/build": status(204),
    "GET /acme/platform/_apis/build/builds": json(fixture("azure-devops/builds-by-branch.json")),
  };
}

function pipelines(r: Parameters<typeof fakeHttp>[0] = routes()) {
  const http = fakeHttp(r);
  return { http, source: azurePipelines(azureApiTransport(http, "acme", memoryTokens({ ado: "pat" }), "ado"), "acme") };
}

describe("azurePipelines checks of an Azure Repos pull request (issue #143)", () => {
  it("reads the build and status policy evaluations, not reviewer policies nor disabled ones", async () => {
    const { source, http } = pipelines();
    expect(await source.checks(PR)).toEqual({
      ok: true,
      checks: [
        {
          name: "api CI", bucket: "fail", state: "rejected",
          link: "https://dev.azure.com/acme/platform/_build/results?buildId=812",
          startedAt: "2026-10-03T19:48:02.113Z", completedAt: "2026-10-03T19:52:40.870Z",
        },
        { name: "security/scan", bucket: "pass", state: "approved", startedAt: "2026-10-03T19:48:05.000Z", completedAt: "2026-10-03T19:49:10.000Z" },
      ],
    });
    const asked = new URL(`https://x${http.requests[1]!.path}`);
    expect(asked.searchParams.get("artifactId")).toBe(`vstfs:///CodeReview/CodeReviewId/${PROJECT_ID}/123`);
    expect(asked.searchParams.get("api-version")).toBe("7.1-preview.1");
  });

  it("names a build policy by its pipeline when it has no display name, and skips what does not apply", async () => {
    const r = await pipelines(routes("policy-evaluations-pass.json")).source.checks(PR);
    expect(r.ok && r.checks.map((c) => [c.name, c.bucket])).toEqual([
      ["acme.api", "pass"],
      ["web CI", "skipping"],
    ]);
  });

  it("waits while a policy runs or is queued", async () => {
    const r = await pipelines(routes("policy-evaluations-running.json")).source.checks(PR);
    expect(r.ok && r.checks.map((c) => c.bucket)).toEqual(["pending", "pending"]);
  });

  it("fails with Azure DevOps' reason, and on a URL that is no Azure Repos pull request", async () => {
    const { source } = pipelines({ "GET /acme/platform/_apis/git/repositories/legacy/pullrequests/123": json(fixture("azure-devops/error-not-found.json"), 404) });
    expect(await source.checks(PR)).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 404") });
    expect(await source.checks({ url: "https://github.com/o/r/pull/1", number: 1 })).toMatchObject({ ok: false });
  });
});

describe("azurePipelines failed logs", () => {
  it("gives the end of each failed task's log, timestamps and colours gone", async () => {
    const { source } = pipelines();
    const [log, ...rest] = await source.failedLogs(PR, [{ name: "acme.api (Unit tests)", link: `${BUILD}&view=logs&jobId=${UNIT_JOB}` }]);
    expect(rest).toEqual([]);
    expect(log!.name).toBe("acme.api (Unit tests)");
    const lines = log!.tail.split("\n");
    expect(lines).toHaveLength(40);
    expect(lines.at(-1)).toBe("##[section]Finishing: Run tests");
    expect(log!.tail).toContain("× src/orders/total.test.ts > total > adds tax");
    expect(log!.tail).not.toMatch(/\u001b|\r|2026-10-03T|﻿/);
    expect(log!.tail).not.toContain("Run lint");
  });

  it("puts every failed task of the build under a check of the whole build", async () => {
    const [log] = await pipelines().source.failedLogs(PR, [{ name: "acme.api", link: BUILD }]);
    expect(log!.tail).toMatch(/^── Run lint ──\n##\[section\]Starting: Run lint\n/);
    expect(log!.tail).toContain("\n\n── Run tests ──\n");
    expect(log!.tail).toContain("12:7  error  'rate' is never reassigned");
  });

  it("reads a build's timeline once, and skips checks that are not builds of its organization", async () => {
    const { source, http } = pipelines();
    const logs = await source.failedLogs(PR, [
      { name: "acme.api", link: BUILD },
      { name: "acme.api (Unit tests)", link: `${BUILD}&view=logs&jobId=${UNIT_JOB}` },
      { name: "other", link: "https://dev.azure.com/globex/p/_build/results?buildId=1" },
      { name: "lint", link: "https://github.com/o/r/actions/runs/1/job/2" },
      { name: "status" },
    ]);
    expect(logs.map((l) => l.name)).toEqual(["acme.api", "acme.api (Unit tests)"]);
    expect(http.requests.filter((r) => r.path.includes("/timeline"))).toHaveLength(1);
  });

  it("strips a log that comes as JSON lines like one that comes as text", () => {
    expect(logTail(fixture("azure-devops/build-log-lint.json"), 2)).toBe("##[error]Bash exited with code '1'.\n##[section]Finishing: Run lint");
    expect(logTail("﻿2026-10-03T19:49:40.0000000Z a\r\n2026-10-03T19:49:41.0000000Z \u001b[31mb\u001b[0m\r\n")).toBe("a\nb");
  });
});

describe("azurePipelines rerun", () => {
  it("retries only the failed stages, without forcing the jobs that passed", async () => {
    const { source, http } = pipelines();
    expect(await source.rerunFailed(PR, [`https://dev.azure.com/acme/${PROJECT_ID}/_build/results?buildId=812`])).toEqual({ ok: true });
    const patches = http.requests.filter((r) => r.method === "PATCH");
    expect(patches).toEqual([expect.objectContaining({ path: `${BUILDS}/stages/build?api-version=7.1`, body: { state: "retry", forceRetryAllJobs: false } })]);
  });

  it("says when a build has no failed stage, or belongs to another organization", async () => {
    const passed = { records: [{ id: "s", type: "Stage", name: "Build", identifier: "build", result: "succeeded" }] };
    const { source } = pipelines({ [`GET ${BUILDS}/timeline`]: json(passed) });
    expect(await source.rerunFailed(PR, [BUILD])).toEqual({ ok: false, error: "build 812 has no failed stage to retry" });
    expect(await source.rerunFailed(PR, ["https://dev.azure.com/globex/p/_build/results?buildId=1"])).toMatchObject({ ok: false });
  });
});

describe("azurePipelines builds by branch", () => {
  const query = { project: "Platform", definitions: [41, 77], branch: "dp/7-fix-the-build" };

  it("takes the newest build of each pipeline on the branch", async () => {
    const { source, http } = pipelines();
    const r = await source.runsOn!(query);
    expect(r).toEqual({
      ok: true,
      checks: [
        {
          name: "acme.api", bucket: "fail", state: "failed", link: "https://dev.azure.com/acme/platform/_build/results?buildId=831",
          startedAt: "2026-10-03T19:48:10.000Z", completedAt: "2026-10-03T19:52:38.000Z",
        },
        { name: "acme.api e2e", bucket: "pending", state: "inProgress", link: "https://dev.azure.com/acme/platform/_build/results?buildId=830", startedAt: "2026-10-03T19:30:09.000Z" },
      ],
    });
    const asked = new URL(`https://x${http.requests[0]!.path}`);
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      definitions: "41,77", branchName: "refs/heads/dp/7-fix-the-build", queryOrder: "queueTimeDescending", $top: "50", "api-version": "7.1",
    });
  });

  it("counts only builds of the head commit when it is known", async () => {
    const r = await pipelines().source.runsOn!({ ...query, head: "B60280BC6E62E2F880F1B63C1E24987664D3BDA3" });
    expect(r.ok && r.checks.map((c) => c.link)).toEqual(["https://dev.azure.com/acme/platform/_build/results?buildId=831"]);
  });
});

describe("azurePipelines through az", () => {
  it("makes the same calls with az rest", async () => {
    const exec = fakeExec({ "az rest --method GET": ok(fixture("azure-devops/build-timeline-failed.json")), "az rest --method PATCH": ok("") });
    const source = azurePipelines(azureCliTransport(exec, "acme"), "acme");
    expect(await source.rerunFailed(PR, [BUILD])).toEqual({ ok: true });
    expect(exec.calls.at(-1)!.args).toEqual([
      "rest", "--method", "PATCH", "--url", `https://dev.azure.com/acme${BUILDS.slice("/acme".length)}/stages/build?api-version=7.1`,
      "--resource", "499b84ac-1321-427f-aa17-267ca6975798", "--only-show-errors",
      "--headers", "Content-Type=application/json", "--body", '{"state":"retry","forceRetryAllJobs":false}',
    ]);
  });
});

ciSourceContract("azure-pipelines", {
  answering: () => pipelines().source,
  failing: () => azurePipelines(azureCliTransport(fakeExec({ "az rest": fail("ERROR: Please run 'az login' to setup account.") }), "acme"), "acme"),
  pr: PR,
  failed: [{ name: "api CI", link: "https://dev.azure.com/acme/platform/_build/results?buildId=812" }],
});
