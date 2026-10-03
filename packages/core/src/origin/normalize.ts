/**
 * Normalise a git remote URL to `host/owner/repo` (lower case), so a clone's `origin` can be
 * matched to an issue's repository. Handles https/http/ssh/git URLs, scp-style `git@host:o/r`,
 * credentials, `.git` suffix and trailing slashes.
 */
export function normalizeOriginUrl(url: string): string {
  let s = url.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme
  s = s.replace(/^[^@/]+@/, ""); // user[:password]@
  s = s.replace(/^([^/:]+):(?!\d+\/)/, "$1/"); // scp-style host:path (but not host:port/)
  s = s.replace(/^([^/:]+):\d+\//, "$1/"); // host:port/
  s = s.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return s.toLowerCase();
}
