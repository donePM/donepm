import { describe, expect, it } from "vitest";
import { gitHubCliConnection } from "../gh/adapter.js";
import { fakeExec } from "../test-support/fake-exec.js";
import { hostOf, noConnection, providerRegistry, type Connection } from "./registry.js";

describe("hostOf", () => {
  it("reads the host of an origin and of a URL", () => {
    expect(hostOf("github.com/acme/widgets")).toBe("github.com");
    expect(hostOf("https://GitHub.com/acme/widgets/pull/7")).toBe("github.com");
    expect(hostOf("not a url://")).toBe("");
  });
});

describe("providerRegistry", () => {
  const exec = fakeExec({});
  const github = gitHubCliConnection(exec);
  const enterprise = gitHubCliConnection(exec, "git.acme.test", "acme");
  const providers = providerRegistry([github, enterprise]);

  it("finds each role by the host of an origin or URL", () => {
    expect(providers.ticketSource("github.com/acme/widgets")).toBe(github.ticketSource);
    expect(providers.codeHost("https://git.acme.test/team/api/pull/3")).toBe(enterprise.codeHost);
    expect(providers.ciSource("git.acme.test/team/api")).toBe(enterprise.ciSource);
  });

  it("has nothing for a host no connection serves", () => {
    expect(providers.codeHost("gitlab.com/acme/widgets")).toBeUndefined();
    expect(noConnection("https://gitlab.com/acme/widgets")).toBe("no connection for gitlab.com");
  });

  it("lists the ticket sources with their connection", () => {
    expect(providers.ticketSources().map((t) => t.connection.id)).toEqual(["github", "acme"]);
  });

  it("finds an Azure DevOps connection by organization, whichever host name a URL uses (issue #141)", () => {
    const acmeAdo: Connection = { id: "ado", kind: "azure-devops", backend: "cli", host: "dev.azure.com", organization: "acme", codeHost: github.codeHost };
    const other: Connection = { id: "ado2", kind: "azure-devops", backend: "cli", host: "dev.azure.com", organization: "contoso", codeHost: enterprise.codeHost };
    const ado = providerRegistry([acmeAdo, other]);
    expect(ado.codeHost("dev.azure.com/acme/platform/legacy")).toBe(github.codeHost);
    expect(ado.codeHost("https://dev.azure.com/contoso/Web/_git/site/pullrequest/4")).toBe(enterprise.codeHost);
    expect(ado.codeHost("https://acme.visualstudio.com/Platform/_git/legacy/pullrequest/4")).toBe(github.codeHost);
    expect(ado.codeHost("dev.azure.com/fabrikam/web/site")).toBeUndefined();
    expect(noConnection("dev.azure.com/fabrikam/web/site")).toBe("no connection for the Azure DevOps organization fabrikam");
  });
});
