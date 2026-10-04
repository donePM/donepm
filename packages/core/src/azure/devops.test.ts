import { describe, expect, it } from "vitest";
import { normalizeOriginUrl } from "../origin/normalize.js";
import {
  azureGitUrl, azureOrganizationOf, azurePrUrl, isAzureDevOpsHost, parseAzureDevOpsOrigin, parseAzurePrUrl,
} from "./devops.js";

const LEGACY = { organization: "acme", project: "platform", repository: "legacy" };

describe("parseAzureDevOpsOrigin (issue #141)", () => {
  it.each([
    "https://dev.azure.com/acme/Platform/_git/legacy",
    "https://acme@dev.azure.com/acme/Platform/_git/legacy",
    "https://dev.azure.com/acme/Platform/_git/legacy/",
    "https://dev.azure.com/acme/Platform/_git/legacy.git",
    "git@ssh.dev.azure.com:v3/acme/Platform/legacy",
    "ssh://git@ssh.dev.azure.com/v3/acme/Platform/legacy",
    "ssh://git@ssh.dev.azure.com:22/v3/acme/Platform/legacy",
    "https://acme.visualstudio.com/Platform/_git/legacy",
    "https://acme.visualstudio.com/DefaultCollection/Platform/_git/legacy",
    "https://acme.visualstudio.com/defaultcollection/Platform/_git/legacy",
    "acme@vs-ssh.visualstudio.com:v3/acme/Platform/legacy",
    "https://dev.azure.com/acme/Platform/_git/_optimized/legacy",
    "HTTPS://DEV.AZURE.COM/ACME/PLATFORM/_GIT/LEGACY",
    "dev.azure.com/acme/platform/legacy",
    "  https://dev.azure.com/acme/Platform/_git/legacy\n",
  ])("%j", (url) => {
    expect(parseAzureDevOpsOrigin(url)).toEqual(LEGACY);
  });

  it("decodes blanks in project and repository names", () => {
    const repo = { organization: "acme", project: "my project", repository: "old app" };
    expect(parseAzureDevOpsOrigin("https://dev.azure.com/acme/My%20Project/_git/Old%20App")).toEqual(repo);
    expect(parseAzureDevOpsOrigin("git@ssh.dev.azure.com:v3/acme/My%20Project/Old%20App")).toEqual(repo);
    expect(parseAzureDevOpsOrigin("dev.azure.com/acme/my project/old app")).toEqual(repo);
  });

  it("takes the project's name for a repository named like its project", () => {
    const repo = { organization: "acme", project: "platform", repository: "platform" };
    expect(parseAzureDevOpsOrigin("https://dev.azure.com/acme/_git/Platform")).toEqual(repo);
    expect(parseAzureDevOpsOrigin("https://acme.visualstudio.com/_git/Platform")).toEqual(repo);
  });

  it.each([
    "https://github.com/acme/legacy",
    "https://dev.azure.com/acme/Platform",
    "https://dev.azure.com/acme/Platform/_git",
    "https://dev.azure.com/acme/Platform/_git/legacy/extra",
    "https://dev.azure.com/acme/Platform/_build/results",
    "git@ssh.dev.azure.com:v2/acme/Platform/legacy",
    "git@ssh.dev.azure.com:v3/acme/Platform",
    "https://dev.azure.com/-acme/Platform/_git/legacy",
    "https://dev.azure.com/acme/../_git/legacy",
    "https://dev.azure.com/acme/_x/_git/legacy",
    "https://dev.azure.com/acme/Platform/_git/a%2Fb",
    "https://dev.azure.com/acme/Platform/_git/bad%ZZ",
    "https://dev.azure.com/acme/Platform/_git/-rf",
    "",
  ])("refuses %j", (url) => {
    expect(parseAzureDevOpsOrigin(url)).toBeUndefined();
  });
});

describe("normalizeOriginUrl for Azure DevOps", () => {
  it("gives every form of one repository one origin", () => {
    const forms = [
      "https://dev.azure.com/acme/Platform/_git/legacy",
      "https://acme@dev.azure.com/acme/Platform/_git/legacy",
      "git@ssh.dev.azure.com:v3/acme/Platform/legacy",
      "https://acme.visualstudio.com/Platform/_git/legacy",
      "https://acme.visualstudio.com/DefaultCollection/Platform/_git/legacy",
      "acme@vs-ssh.visualstudio.com:v3/acme/Platform/legacy",
    ];
    expect(new Set(forms.map(normalizeOriginUrl))).toEqual(new Set(["dev.azure.com/acme/platform/legacy"]));
  });

  it("is idempotent, blanks included", () => {
    const origin = normalizeOriginUrl("https://dev.azure.com/acme/My%20Project/_git/legacy");
    expect(origin).toBe("dev.azure.com/acme/my project/legacy");
    expect(normalizeOriginUrl(origin)).toBe(origin);
  });
});

describe("Azure DevOps URLs", () => {
  it("builds the clone and pull request URLs, encoded", () => {
    const repo = { organization: "acme", project: "my project", repository: "legacy" };
    expect(azureGitUrl(repo)).toBe("https://dev.azure.com/acme/my%20project/_git/legacy");
    expect(azurePrUrl(repo, 12)).toBe("https://dev.azure.com/acme/my%20project/_git/legacy/pullrequest/12");
  });

  it("reads a pull request's web URL in either host form", () => {
    expect(parseAzurePrUrl("https://dev.azure.com/acme/Platform/_git/legacy/pullrequest/123")).toEqual({ repo: LEGACY, number: 123 });
    expect(parseAzurePrUrl("https://acme.visualstudio.com/Platform/_git/legacy/pullrequest/7?_a=files")).toEqual({ repo: LEGACY, number: 7 });
    expect(parseAzurePrUrl("https://github.com/acme/legacy/pull/1")).toBeUndefined();
    expect(parseAzurePrUrl("https://dev.azure.com/acme/Platform/_git/legacy")).toBeUndefined();
  });

  it("names the organization of an origin or URL", () => {
    expect(azureOrganizationOf("dev.azure.com/acme/platform/legacy")).toBe("acme");
    expect(azureOrganizationOf("https://dev.azure.com/Acme/Platform/_build/results?buildId=4")).toBe("acme");
    expect(azureOrganizationOf("https://acme.visualstudio.com/Platform/_build/results?buildId=4")).toBe("acme");
    expect(azureOrganizationOf("git@ssh.dev.azure.com:v3/acme/Platform/legacy")).toBe("acme");
    expect(azureOrganizationOf("https://github.com/acme/legacy")).toBeUndefined();
  });

  it("knows Azure DevOps hosts", () => {
    expect(["dev.azure.com", "ssh.dev.azure.com", "acme.visualstudio.com"].every(isAzureDevOpsHost)).toBe(true);
    expect(isAzureDevOpsHost("github.com")).toBe(false);
  });
});
