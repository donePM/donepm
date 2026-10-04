import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../test-support/fake-exec.js";
import { fakeHttp, json, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureApiHealth, azureCliHealth, azureDevOpsConnection } from "./connection.js";
import { azureApiTransport } from "./transport.js";

describe("azureCliHealth (issue #141)", () => {
  it("is ready with the account az is logged in as", async () => {
    const exec = fakeExec({ "az --version": ok("azure-cli 2.70.0\n"), "az account show": ok(fixture("azure-devops/az-account-show.json")) });
    expect(await azureCliHealth(exec)).toEqual({ state: "ready", detail: "jamal@acme.example" });
  });

  it("is not installed without az, and not logged in without az login", async () => {
    expect(await azureCliHealth(fakeExec({}))).toEqual({ state: "not_installed" });
    expect(await azureCliHealth(fakeExec({ "az --version": ok(""), "az account show": fail("ERROR: Please run 'az login' to setup account.") })))
      .toEqual({ state: "not_logged_in", detail: "run az login" });
  });
});

describe("azureApiHealth", () => {
  const health = (answer: Parameters<typeof fakeHttp>[0][string], token: string | null = "pat") =>
    azureApiHealth(azureApiTransport(fakeHttp({ "GET /acme/_apis/connectionData": answer }), "acme", memoryTokens(token === null ? {} : { ado: token }), "ado"));

  it("is ready with the token's user when the organization answers connectionData", async () => {
    expect(await health(json(fixture("azure-devops/connection-data.json")))).toEqual({ state: "ready", detail: "Jamal Hartnett" });
  });

  it("is unauthorized for a refused or missing token, unreachable without an answer", async () => {
    expect((await health(status(401))).state).toBe("unauthorized");
    expect((await health(status(203, "<html/>"))).state).toBe("unauthorized");
    expect((await health(json({}), null)).state).toBe("unauthorized");
    expect((await health(status(0, "timeout"))).state).toBe("unreachable");
  });
});

describe("azureDevOpsConnection", () => {
  it("serves one organization on dev.azure.com as a code host with a health check", () => {
    const c = azureDevOpsConnection({ id: "ado", organization: "acme", backend: "api", exec: fakeExec({}), http: fakeHttp({}), tokens: memoryTokens() });
    expect(c).toMatchObject({ id: "ado", kind: "azure-devops", backend: "api", host: "dev.azure.com", organization: "acme" });
    expect(c.codeHost).toBeDefined();
    expect(c.ticketSource).toBeUndefined();
    expect(c.health).toBeTypeOf("function");
  });
});
