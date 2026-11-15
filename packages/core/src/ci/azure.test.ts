import { describe, expect, it } from "vitest";
import { azureBuildBucket, azureBuildUrl, azurePolicyBucket, parseAzureBuildLink } from "./azure.js";

describe("parseAzureBuildLink", () => {
  it("reads organization, project and build from both host forms", () => {
    expect(parseAzureBuildLink("https://dev.azure.com/Acme/Platform%20Team/_build/results?buildId=812")).toEqual({ organization: "acme", project: "platform team", buildId: 812 });
    expect(parseAzureBuildLink("https://acme.visualstudio.com/Platform/_build/results?buildId=7")).toEqual({ organization: "acme", project: "platform", buildId: 7 });
    expect(parseAzureBuildLink("https://acme.visualstudio.com/DefaultCollection/Platform/_build/results?buildId=7")).toMatchObject({ project: "platform", buildId: 7 });
  });

  it("keeps the job of a job's link", () => {
    expect(parseAzureBuildLink("https://dev.azure.com/acme/platform/_build/results?buildId=812&view=logs&jobId=AB12")).toMatchObject({ buildId: 812, jobId: "ab12" });
  });

  it("refuses anything else", () => {
    expect(parseAzureBuildLink(undefined)).toBeUndefined();
    expect(parseAzureBuildLink("not a url")).toBeUndefined();
    expect(parseAzureBuildLink("https://dev.azure.com/acme/platform/_build/results")).toBeUndefined();
    expect(parseAzureBuildLink("https://dev.azure.com/acme/platform/_build/results?buildId=x")).toBeUndefined();
    expect(parseAzureBuildLink("https://dev.azure.com/acme/platform/_git/api/pullrequest/4")).toBeUndefined();
    expect(parseAzureBuildLink("https://github.com/o/r/actions/runs/5")).toBeUndefined();
  });

  it("round-trips through azureBuildUrl", () => {
    const url = azureBuildUrl({ organization: "acme", project: "platform team", buildId: 812 });
    expect(url).toBe("https://dev.azure.com/acme/platform%20team/_build/results?buildId=812");
    expect(parseAzureBuildLink(url)).toEqual({ organization: "acme", project: "platform team", buildId: 812 });
  });
});

describe("azurePolicyBucket", () => {
  it.each([
    ["approved", "pass"],
    ["rejected", "fail"],
    ["broken", "fail"],
    ["running", "pending"],
    ["queued", "pending"],
    ["notApplicable", "skipping"],
    ["somethingNew", "pending"],
  ])("%s is %s", (status, bucket) => expect(azurePolicyBucket(status)).toBe(bucket));
});

describe("azureBuildBucket", () => {
  it.each([
    ["completed", "succeeded", "pass"],
    ["completed", "partiallySucceeded", "pass"],
    ["completed", "failed", "fail"],
    ["completed", "canceled", "cancel"],
    ["completed", "none", "fail"],
    ["inProgress", "none", "pending"],
    ["notStarted", undefined, "pending"],
    ["cancelling", undefined, "pending"],
  ])("%s/%s is %s", (status, result, bucket) => expect(azureBuildBucket(status, result)).toBe(bucket));
});
