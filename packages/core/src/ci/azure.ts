import { azureOrganizationOf, azureOrganizationUrl } from "../azure/devops.js";

/** One Azure Pipelines build, as a check's link names it (issue #143). */
export interface AzureBuild {
  /** Lower case. */
  organization: string;
  /** As the link names it: a name (lower case) or the project's id. */
  project: string;
  buildId: number;
  /** The job a check of one job links to (`&jobId=`), if any. */
  jobId?: string;
}

/**
 * The build an Azure Pipelines link points at: `https://dev.azure.com/<org>/<project>/_build/results?buildId=<id>`
 * or the same on `<org>.visualstudio.com`, as Azure Pipelines reports a check to GitHub and as
 * donePM builds it from a policy evaluation. Undefined for any other link.
 */
export function parseAzureBuildLink(link: string | undefined): AzureBuild | undefined {
  if (!link) return undefined;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  const organization = azureOrganizationOf(link);
  if (!organization) return undefined;
  const path = url.pathname.split("/").filter(Boolean);
  const rest = url.hostname.toLowerCase() === "dev.azure.com" ? path.slice(1) : path[0]?.toLowerCase() === "defaultcollection" ? path.slice(1) : path;
  if (rest.length !== 3 || rest[1]!.toLowerCase() !== "_build" || rest[2]!.toLowerCase() !== "results") return undefined;
  const buildId = url.searchParams.get("buildId");
  if (!buildId || !/^\d+$/.test(buildId)) return undefined;
  let project: string;
  try {
    project = decodeURIComponent(rest[0]!).toLowerCase();
  } catch {
    return undefined;
  }
  const jobId = url.searchParams.get("jobId") ?? undefined;
  return { organization, project, buildId: Number(buildId), ...(jobId ? { jobId: jobId.toLowerCase() } : {}) };
}

/** `https://dev.azure.com/<org>/<project>/_build/results?buildId=<id>`: the build's page, and its run key. */
export function azureBuildUrl(build: Pick<AzureBuild, "organization" | "project" | "buildId">): string {
  return `${azureOrganizationUrl(build.organization)}/${encodeURIComponent(build.project)}/_build/results?buildId=${build.buildId}`;
}

/**
 * What an Azure DevOps policy evaluation's `status` means as a check (issue #143): approved passes,
 * rejected and broken fail, queued and running wait, notApplicable is skipped. Anything else waits:
 * a status donePM does not know is never taken as green.
 */
export function azurePolicyBucket(status: string): "pass" | "fail" | "pending" | "skipping" {
  switch (status.toLowerCase()) {
    case "approved":
      return "pass";
    case "rejected":
    case "broken":
      return "fail";
    case "notapplicable":
      return "skipping";
    default:
      return "pending";
  }
}

/**
 * What an Azure Pipelines build's `status` and `result` mean as a check: a completed build passed
 * if it succeeded or partially succeeded (its failing tasks were allowed to fail), cancelled if it
 * was, and failed otherwise. Every other status waits.
 */
export function azureBuildBucket(status: string, result: string | undefined): "pass" | "fail" | "pending" | "cancel" {
  if (status.toLowerCase() !== "completed") return "pending";
  switch ((result ?? "").toLowerCase()) {
    case "succeeded":
    case "partiallysucceeded":
      return "pass";
    case "canceled":
      return "cancel";
    default:
      // failed, or a result donePM does not know: never taken as green, and the wait ends.
      return "fail";
  }
}
