import { describe, expect, it } from "vitest";
import { fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fakeHttp, json } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { testConnection } from "./connection-test.js";

describe("testConnection", () => {
  it("asks gh about a GitHub host", async () => {
    const exec = fakeExec({ "which gh": ok("/opt/homebrew/bin/gh\n"), "gh auth status": ok(fixture("gh/auth-status-ok.stdout")) });
    const r = await testConnection({ id: "acme", kind: "github", backend: "cli", host: "github.acme.com" }, { exec, http: fakeHttp({}), tokens: memoryTokens() });
    expect(r).toMatchObject({ ok: true, state: "ready" });
    expect(exec.calls[1]!.args).toEqual(["auth", "status", "--hostname", "github.acme.com"]);
  });

  it("asks a Jira site what it is and who the token is", async () => {
    const http = fakeHttp({
      "GET /rest/api/2/serverInfo": json(fixture("jira/dc-server-info.json")),
      "GET /rest/api/2/myself": json(fixture("jira/dc-myself.json")),
    });
    const r = await testConnection(
      { id: "jira", kind: "jira", backend: "api", baseUrl: "https://jira.acme.com", deployment: "datacenter" },
      { exec: fakeExec({}), http, tokens: memoryTokens({ jira: "pat" }) },
    );
    expect(r).toEqual({ ok: true, state: "ready", detail: "Dana Developer", deployment: "datacenter" });
  });

  it("asks az, or the organization's API, who is signed in to Azure DevOps (issue #141)", async () => {
    const exec = fakeExec({ "az --version": ok("azure-cli 2.70.0\n"), "az account show": ok(fixture("azure-devops/az-account-show.json")) });
    const cli = { id: "ado", kind: "azure-devops", backend: "cli", host: "dev.azure.com", organization: "acme" } as const;
    expect(await testConnection(cli, { exec, http: fakeHttp({}), tokens: memoryTokens() })).toEqual({ ok: true, state: "ready", detail: "jamal@acme.example" });

    const http = fakeHttp({ "GET /acme/_apis/connectionData": json(fixture("azure-devops/connection-data.json")) });
    const api = { ...cli, backend: "api" } as const;
    expect(await testConnection(api, { exec: fakeExec({}), http, tokens: memoryTokens({ ado: "pat" }) })).toEqual({ ok: true, state: "ready", detail: "Jamal Hartnett" });
    expect(await testConnection(api, { exec: fakeExec({}), http, tokens: memoryTokens() })).toMatchObject({ ok: false, state: "unauthorized" });
  });
});
