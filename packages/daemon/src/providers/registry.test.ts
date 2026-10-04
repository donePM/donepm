import { describe, expect, it } from "vitest";
import { gitHubCliConnection } from "../gh/adapter.js";
import { fakeExec } from "../test-support/fake-exec.js";
import { hostOf, noConnection, providerRegistry } from "./registry.js";

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
});
