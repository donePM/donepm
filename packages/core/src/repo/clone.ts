import { AZURE_DEVOPS_HOST, azureOrigin, parseAzureDevOpsOrigin, type AzureRepo } from "../azure/devops.js";
import { GITHUB_COM } from "../github/host.js";
import { normalizeOriginUrl } from "../origin/normalize.js";

/**
 * A normalised origin split for cloning: its host and the path segments after it, `[owner, repo]`
 * on GitHub, `[organization, project, repository]` on Azure DevOps (issue #141).
 */
export interface CloneOrigin {
  host: string;
  path: string[];
  /** Set for an Azure DevOps origin. */
  azure?: AzureRepo;
}

// GitHub: owners are letters, digits and hyphens, plus `_` for managed users on GitHub Enterprise
// (`jdoe_acme`); repository names also have `.` and `_`.
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const OWNER = /^[a-z0-9][a-z0-9_-]*$/;
const REPO = /^[a-z0-9._][a-z0-9._-]*$/;

/**
 * Split a normalised origin (`github.com/owner/repo`, `dev.azure.com/org/project/repo`) for
 * cloning. Strict, since the parts become path segments and command arguments: no `.` or `..`, no
 * separators, nothing that starts with `-`. Undefined for anything else.
 */
export function parseCloneOrigin(origin: string): CloneOrigin | undefined {
  if (origin !== normalizeOriginUrl(origin)) return undefined;
  if (origin.startsWith(`${AZURE_DEVOPS_HOST}/`)) {
    const azure = parseAzureDevOpsOrigin(origin);
    if (!azure || azureOrigin(azure) !== origin) return undefined;
    return { host: AZURE_DEVOPS_HOST, path: [azure.organization, azure.project, azure.repository], azure };
  }
  const parts = origin.split("/");
  if (parts.length !== 3) return undefined;
  const [host, owner, repo] = parts as [string, string, string];
  if (!HOST.test(host) || !OWNER.test(owner) || !REPO.test(repo)) return undefined;
  if (/^\.+$/.test(repo)) return undefined;
  return { host, path: [owner, repo] };
}

/**
 * Where below `repoRoot` a clone of the origin lands, as path segments. github.com keeps
 * `<owner>/<repo>`, where clones have always been. Every other host goes under its own folder,
 * `<host>/<path…>` (`github.acme.com/team/app`, `dev.azure.com/acme/platform/legacy`), so the same
 * names on two hosts never meet in one folder (issue #141).
 */
export function cloneSegments(origin: CloneOrigin): string[] {
  return origin.host === GITHUB_COM ? origin.path : [origin.host, ...origin.path];
}
