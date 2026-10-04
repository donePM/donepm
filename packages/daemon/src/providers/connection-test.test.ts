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
});
