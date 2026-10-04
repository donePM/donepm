import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { pipelinesOptIn } from "./pipelines.js";

const GHE = { id: "ghe", kind: "github", host: "github.acme.com" };
const ADO = { id: "ado", kind: "azure-devops", organization: "acme" };

function config(origin: string, ci: object, connections: object[] = [GHE, ADO]): string {
  return JSON.stringify({ connections, sources: { [origin]: { managed: true, ci } } });
}

describe("pipelinesOptIn (issue #143)", () => {
  it("takes the organization and project of an Azure Repos origin unless the opt-in names them", () => {
    expect(pipelinesOptIn("dev.azure.com/acme/platform/legacy", { source: "azure-pipelines", definitions: [41] })).toEqual({
      organization: "acme", project: "platform", definitions: [41],
    });
    expect(pipelinesOptIn("dev.azure.com/acme/platform/legacy", { source: "azure-pipelines", definitions: [41], project: "Shared" })).toMatchObject({ project: "Shared" });
  });

  it("needs both named for any other origin, and is nothing without an opt-in", () => {
    expect(pipelinesOptIn("github.acme.com/team/api", { source: "azure-pipelines", definitions: [41], organization: "acme" })).toBeUndefined();
    expect(pipelinesOptIn("github.acme.com/team/api", { source: "azure-pipelines", definitions: [41], organization: "acme", project: "Platform" })).toEqual({
      organization: "acme", project: "Platform", definitions: [41],
    });
    expect(pipelinesOptIn("github.acme.com/team/api", undefined)).toBeUndefined();
  });
});

describe("the ci opt-in in the config", () => {
  it("is kept on a source", () => {
    const ci = { source: "azure-pipelines", definitions: [41, 77], organization: "Acme", project: "Platform" };
    expect(parseConfig(config("github.acme.com/team/api", ci)).sources["github.acme.com/team/api"]!.ci).toEqual({ ...ci, organization: "acme" });
  });

  it("refuses an opt-in that cannot say where its pipelines are", () => {
    expect(() => parseConfig(config("github.acme.com/team/api", { source: "azure-pipelines", definitions: [41] }))).toThrow(/organization and project/);
  });

  it("refuses an opt-in for an organization no connection serves", () => {
    const ci = { source: "azure-pipelines", definitions: [41], organization: "globex", project: "web" };
    expect(() => parseConfig(config("github.acme.com/team/api", ci))).toThrow(/organization globex; add one under "connections"/);
  });

  it("refuses an unknown CI, no pipelines, or keys it does not know", () => {
    for (const ci of [
      { source: "jenkins", definitions: [1] },
      { source: "azure-pipelines", definitions: [] },
      { source: "azure-pipelines", definitions: [41], branch: "main" },
    ]) {
      expect(() => parseConfig(config("dev.azure.com/acme/platform/legacy", ci))).toThrow();
    }
  });
});
