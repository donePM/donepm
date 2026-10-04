import { normalizeOriginUrl } from "../origin/normalize.js";

export interface CloneOrigin {
  host: string;
  owner: string;
  repo: string;
}

// GitHub: owners are letters, digits and hyphens; repository names also have `.` and `_`.
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const OWNER = /^[a-z0-9][a-z0-9-]*$/;
const REPO = /^[a-z0-9._][a-z0-9._-]*$/;

/**
 * Split a normalised origin (`github.com/owner/repo`) for cloning it into `<root>/<owner>/<repo>`.
 * Strict, since the parts become path segments and command arguments: exactly three segments, no
 * `.` or `..`, no separators, nothing that starts with `-`. Undefined for anything else.
 */
export function parseCloneOrigin(origin: string): CloneOrigin | undefined {
  if (origin !== normalizeOriginUrl(origin)) return undefined;
  const parts = origin.split("/");
  if (parts.length !== 3) return undefined;
  const [host, owner, repo] = parts as [string, string, string];
  if (!HOST.test(host) || !OWNER.test(owner) || !REPO.test(repo)) return undefined;
  if (/^\.+$/.test(repo)) return undefined;
  return { host, owner, repo };
}
