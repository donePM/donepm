import { azureOrigin, parseAzureDevOpsOrigin } from "../azure/devops.js";

/**
 * Normalise a git remote URL to `host/owner/repo` (lower case), so a clone's `origin` can be
 * matched to an issue's repository. Handles https/http/ssh/git URLs, scp-style `git@host:o/r`,
 * credentials, `.git` suffix and trailing slashes. Every form of an Azure DevOps remote becomes
 * `dev.azure.com/<org>/<project>/<repo>`, decoded (issue #141).
 */
export function normalizeOriginUrl(url: string): string {
  const azure = parseAzureDevOpsOrigin(url);
  if (azure) return azureOrigin(azure);
  let s = url.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme
  s = s.replace(/^[^@/]+@/, ""); // user[:password]@
  s = s.replace(/^([^/:]+):(?!\d+\/)/, "$1/"); // scp-style host:path (but not host:port/)
  s = s.replace(/^([^/:]+):\d+\//, "$1/"); // host:port/
  s = s.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return s.toLowerCase();
}
