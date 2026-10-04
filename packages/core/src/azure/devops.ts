/** The host of every Azure DevOps Services origin donePM stores (issue #141). */
export const AZURE_DEVOPS_HOST = "dev.azure.com";

/** An Azure DevOps Repos repository: organization, project and repository, lower case and decoded. */
export interface AzureRepo {
  organization: string;
  project: string;
  repository: string;
}

const ORGANIZATION = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/**
 * Project and repository names may have blanks and most punctuation, but none of the characters
 * Azure DevOps refuses in them, and they never start with `.`, `_` or `-` nor end with `.`. Names
 * end up as path segments and command arguments, so this is strict.
 */
const NAME_FORBIDDEN = /[\u0000-\u001f\u007f/\\:*?"<>|;#$%&{},+=[\]]/;

function validName(name: string): boolean {
  return name.trim() === name && name !== "" && !NAME_FORBIDDEN.test(name) && !/^[._-]/.test(name) && !name.endsWith(".");
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return undefined;
  }
}

/** `host` and path segments of a remote URL, an scp-style address or a bare `host/path`. */
function split(url: string): { host: string; path: string[] } {
  let s = url.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme
  s = s.replace(/^[^@/]+@/, ""); // user[:password]@
  s = s.replace(/^([^/:]+):(?!\d+\/)/, "$1/"); // scp-style host:path
  s = s.replace(/^([^/:]+):\d+\//, "$1/"); // host:port/
  s = s.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const [host = "", ...path] = s.split("/");
  return { host: host.toLowerCase(), path };
}

/** `[project, "_git", repo]` or `["_git", repo]` (project named like its repository). */
function fromGitPath(path: string[]): [string, string] | undefined {
  const rest = path.filter((p, i) => !(i > 0 && path[i - 1]?.toLowerCase() === "_git" && /^_(optimized|full)$/i.test(p)));
  if (rest.length === 3 && rest[1]!.toLowerCase() === "_git") return [rest[0]!, rest[2]!];
  if (rest.length === 2 && rest[0]!.toLowerCase() === "_git") return [rest[1]!, rest[1]!];
  return undefined;
}

const LEGACY = /^([a-z0-9][a-z0-9-]*)\.visualstudio\.com$/;

function raw(url: string): [string, string, string] | undefined {
  const { host, path } = split(url);
  if (host === AZURE_DEVOPS_HOST) {
    const [org, ...rest] = path;
    if (!org) return undefined;
    // The canonical form itself, so normalising is idempotent.
    if (rest.length === 2 && !rest.some((p) => p.toLowerCase() === "_git")) return [org, rest[0]!, rest[1]!];
    const pr = fromGitPath(rest);
    return pr && [org, ...pr];
  }
  if (host === "ssh.dev.azure.com" || host === "vs-ssh.visualstudio.com") {
    if (path.length !== 4 || path[0]!.toLowerCase() !== "v3") return undefined;
    return [path[1]!, path[2]!, path[3]!];
  }
  const legacy = LEGACY.exec(host);
  if (legacy && host !== "vs-ssh.visualstudio.com") {
    const rest = path[0]?.toLowerCase() === "defaultcollection" ? path.slice(1) : path;
    const pr = fromGitPath(rest);
    return pr && [legacy[1]!, ...pr];
  }
  return undefined;
}

/**
 * The repository an Azure DevOps remote names, in any of its forms (issue #141):
 * `https://dev.azure.com/acme/Platform/_git/legacy`, the same with `acme@` before the host,
 * `git@ssh.dev.azure.com:v3/acme/Platform/legacy`, `https://acme.visualstudio.com/[DefaultCollection/]Platform/_git/legacy`,
 * `acme@vs-ssh.visualstudio.com:v3/acme/Platform/legacy`, `…/_git/<repo>` for a repository named
 * like its project, and the canonical `dev.azure.com/acme/platform/legacy`. Lower case, `%20`
 * decoded. Undefined for anything else, including a name Azure DevOps would refuse.
 */
export function parseAzureDevOpsOrigin(url: string): AzureRepo | undefined {
  const parts = raw(url);
  if (!parts) return undefined;
  const [organization, project, repository] = parts.map(decode);
  if (organization === undefined || project === undefined || repository === undefined) return undefined;
  if (!ORGANIZATION.test(organization) || !validName(project) || !validName(repository)) return undefined;
  return { organization, project, repository };
}

/** `dev.azure.com/<org>/<project>/<repo>`: the one origin all forms of a repository share. */
export function azureOrigin(repo: AzureRepo): string {
  return `${AZURE_DEVOPS_HOST}/${repo.organization}/${repo.project}/${repo.repository}`;
}

/** `https://dev.azure.com/<org>`, as `az --organization` takes it. */
export function azureOrganizationUrl(organization: string): string {
  return `https://${AZURE_DEVOPS_HOST}/${encodeURIComponent(organization)}`;
}

/** `https://dev.azure.com/<org>/<project>/_git/<repo>`: what `git clone` takes and the web shows. */
export function azureGitUrl(repo: AzureRepo): string {
  return `${azureOrganizationUrl(repo.organization)}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}`;
}

/** The web URL of a pull request: `https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<n>`. */
export function azurePrUrl(repo: AzureRepo, number: number): string {
  return `${azureGitUrl(repo)}/pullrequest/${number}`;
}

/** The repository and number of a pull request's web URL, in either host form. */
export function parseAzurePrUrl(url: string): { repo: AzureRepo; number: number } | undefined {
  const m = /^(.*)\/pullrequest\/(\d+)\/?(?:[?#].*)?$/i.exec(url.trim());
  if (!m) return undefined;
  const repo = parseAzureDevOpsOrigin(m[1]!);
  return repo ? { repo, number: Number(m[2]) } : undefined;
}

/** Whether a host is one of Azure DevOps Services' (`dev.azure.com`, `ssh.dev.azure.com`, `*.visualstudio.com`). */
export function isAzureDevOpsHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === AZURE_DEVOPS_HOST || h === "ssh.dev.azure.com" || h.endsWith(".visualstudio.com");
}

/**
 * The organization an Azure DevOps origin or URL belongs to, lower case: the first path segment
 * on `dev.azure.com`, the subdomain on `<org>.visualstudio.com`. Undefined for any other host.
 */
export function azureOrganizationOf(where: string): string | undefined {
  const { host, path } = split(where);
  let org: string | undefined;
  if (host === AZURE_DEVOPS_HOST) org = path[0];
  else if (host === "ssh.dev.azure.com" || host === "vs-ssh.visualstudio.com") org = path[0]?.toLowerCase() === "v3" ? path[1] : undefined;
  else org = LEGACY.exec(host)?.[1];
  const decoded = org === undefined ? undefined : decode(org);
  return decoded && ORGANIZATION.test(decoded) ? decoded : undefined;
}
