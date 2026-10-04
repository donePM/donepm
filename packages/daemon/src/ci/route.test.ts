import type { CiPr, FailedCheck } from "@donepm/core";
import { describe, expect, it } from "vitest";
import type { CiSource } from "../providers/ci-source.js";
import { providerRegistry, type Connection } from "../providers/registry.js";
import { ciSourceFor } from "./route.js";

const PR = { url: "https://github.acme.com/team/api/pull/9", number: 9 };
const ACME = "https://dev.azure.com/acme/platform/_build/results?buildId=812";
const GLOBEX = "https://dev.azure.com/globex/web/_build/results?buildId=3";
const ACTIONS = "https://github.acme.com/team/api/actions/runs/5512/job/90211";

/** A CI source that names itself in what it answers and records what it was asked. */
function recording(label: string, refuse?: string) {
  const asked: Array<{ call: string; pr: CiPr; what: string[] }> = [];
  const source: CiSource = {
    checks: async (pr) => (asked.push({ call: "checks", pr, what: [] }), { ok: true, checks: [{ name: label, bucket: "pass", state: "SUCCESS" }] }),
    failedLogs: async (pr, failed) => (
      asked.push({ call: "failedLogs", pr, what: failed.map((c) => c.name) }), failed.map((c) => ({ name: c.name, tail: `${label}: ${c.name}` }))
    ),
    rerunFailed: async (pr, runs) => (asked.push({ call: "rerunFailed", pr, what: [...runs] }), refuse ? { ok: false, error: refuse } : { ok: true }),
  };
  return { source, asked };
}

function setup(refuse?: string) {
  const host = recording("ghe");
  const acme = recording("acme", refuse);
  const connections: Connection[] = [
    { id: "ghe", kind: "github", backend: "cli", host: "github.acme.com", ciSource: host.source },
    { id: "ado", kind: "azure-devops", backend: "api", host: "dev.azure.com", organization: "acme", ciSource: acme.source },
  ];
  return { host, acme, ci: ciSourceFor(providerRegistry(connections), PR.url)! };
}

describe("ciSourceFor (issue #143)", () => {
  it("reads the checks from the pull request's host alone", async () => {
    const t = setup();
    expect(await t.ci.checks(PR)).toMatchObject({ ok: true, checks: [{ name: "ghe" }] });
    expect(t.acme.asked).toEqual([]);
  });

  it("reads the log of an Azure Pipelines build from its organization's connection, the rest from the host", async () => {
    const t = setup();
    const failed: FailedCheck[] = [
      { name: "acme.api", link: ACME },
      { name: "lint", link: ACTIONS },
      { name: "web", link: GLOBEX },
      { name: "acme.api (Unit tests)", link: `${ACME}&jobId=a1` },
    ];
    expect(await t.ci.failedLogs(PR, failed)).toEqual([
      { name: "acme.api", tail: "acme: acme.api" },
      { name: "lint", tail: "ghe: lint" },
      { name: "acme.api (Unit tests)", tail: "acme: acme.api (Unit tests)" },
    ]);
    expect(t.acme.asked).toEqual([{ call: "failedLogs", pr: PR, what: ["acme.api", "acme.api (Unit tests)"] }]);
    expect(t.host.asked).toEqual([{ call: "failedLogs", pr: PR, what: ["lint"] }]);
  });

  it("reruns each run on its own side, and stops at the first that fails", async () => {
    const t = setup();
    expect(await t.ci.rerunFailed(PR, ["5512", ACME])).toEqual({ ok: true });
    expect(t.host.asked).toEqual([{ call: "rerunFailed", pr: PR, what: ["5512"] }]);
    expect(t.acme.asked).toEqual([{ call: "rerunFailed", pr: PR, what: [ACME] }]);

    expect(await t.ci.rerunFailed(PR, [GLOBEX, "5512"])).toEqual({ ok: false, error: "no connection for the Azure DevOps organization globex" });
    expect(t.host.asked).toHaveLength(1);

    expect(await setup("build 812 has no failed stage to retry").ci.rerunFailed(PR, [ACME])).toEqual({ ok: false, error: "build 812 has no failed stage to retry" });
  });

  it("has nothing for a pull request no connection hosts", () => {
    expect(ciSourceFor(providerRegistry([]), PR.url)).toBeUndefined();
  });
});
