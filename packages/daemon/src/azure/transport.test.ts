import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { fakeHttp, json, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { AZURE_DEVOPS_RESOURCE, azureApiTransport, azureCliTransport, azureUrl } from "./transport.js";

const PAT = "s3cr3t-pat-value";

describe("azureUrl", () => {
  it("is below the organization, with an api-version", () => {
    expect(azureUrl("acme", { path: "Platform/_apis/git/repositories/legacy" })).toBe("https://dev.azure.com/acme/Platform/_apis/git/repositories/legacy?api-version=7.1");
    expect(azureUrl("acme", { path: "_apis/connectionData", query: { "api-version": "7.1-preview" } })).toBe("https://dev.azure.com/acme/_apis/connectionData?api-version=7.1-preview");
  });
});

describe("azureApiTransport", () => {
  it("sends the token from the Keychain as basic auth, read at call time", async () => {
    const http = fakeHttp({ "GET /acme/_apis/projects": json({ value: [] }) });
    const r = await azureApiTransport(http, "acme", memoryTokens({ ado: PAT }), "ado")({ method: "GET", path: "_apis/projects" });
    expect(r).toEqual({ ok: true, body: '{"value":[]}' });
    expect(http.requests[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`:${PAT}`).toString("base64")}`);
    expect(http.requests[0]!.host).toBe("dev.azure.com");
  });

  it("calls nothing without a token", async () => {
    const http = fakeHttp({});
    expect(await azureApiTransport(http, "acme", memoryTokens(), "ado")({ method: "GET", path: "_apis/projects" }))
      .toEqual({ ok: false, error: "no API token for ado in the Keychain", reason: "unauthorized" });
    expect(http.requests).toHaveLength(0);
  });

  it.each([
    [status(401), "unauthorized"],
    [status(203, "<html>Sign in</html>"), "unauthorized"],
    [status(0, "getaddrinfo ENOTFOUND dev.azure.com"), "unreachable"],
    [json({ message: "TF400813: not authorized" }, 403), undefined],
  ])("fails with a reason that never holds the token: %j", async (answer, reason) => {
    const r = await azureApiTransport(fakeHttp({ "GET /acme": answer }), "acme", memoryTokens({ ado: PAT }), "ado")({ method: "GET", path: "_apis/projects" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(reason);
    expect(r.error).not.toContain(PAT);
    expect(r.error).toMatch(/\S/);
  });
});

describe("azureCliTransport", () => {
  it("calls the same REST API through az rest with the Azure DevOps resource, the body as JSON", async () => {
    const exec = fakeExec({ "az rest": ok('{"pullRequestId":5}') });
    const r = await azureCliTransport(exec, "acme")({ method: "POST", path: "Platform/_apis/git/repositories/legacy/pullrequests", body: { title: "-x" } });
    expect(r).toEqual({ ok: true, body: '{"pullRequestId":5}' });
    expect(exec.calls[0]!.args).toEqual([
      "rest", "--method", "POST", "--url", "https://dev.azure.com/acme/Platform/_apis/git/repositories/legacy/pullrequests?api-version=7.1",
      "--resource", AZURE_DEVOPS_RESOURCE, "--only-show-errors", "--headers", "Content-Type=application/json", "--body", '{"title":"-x"}',
    ]);
  });

  it("fails with az's reason, or says az is missing", async () => {
    expect(await azureCliTransport(fakeExec({ az: fail("ERROR: Please run 'az login' to setup account.") }), "acme")({ method: "GET", path: "_apis/projects" }))
      .toEqual({ ok: false, error: "ERROR: Please run 'az login' to setup account." });
    expect(await azureCliTransport(fakeExec({ az: fail("spawn az ENOENT", -1) }), "acme")({ method: "GET", path: "_apis/projects" }))
      .toEqual({ ok: false, error: "az is not installed" });
  });
});
