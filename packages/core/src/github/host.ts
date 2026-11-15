/** The GitHub every install has. More hosts (GitHub Enterprise Server, GHE.com) are added by the user (issue #140). */
export const GITHUB_COM = "github.com";

/** The lower-case host of a URL, or undefined when it is not one. */
export function hostOfUrl(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** The host of a normalised origin (`github.acme.com/team/app` → `github.acme.com`). */
export function hostOfOrigin(origin: string): string {
  return origin.split("/")[0] ?? "";
}

/**
 * `owner/repo` on github.com, `host/owner/repo` on any other host: how an item's `externalId` and
 * `gh --repo` name a repository. gh takes both forms; the short one keeps github.com ids as they were.
 */
export function qualifiedRepository(host: string | undefined, repository: string): string {
  return !host || host === GITHUB_COM ? repository : `${host}/${repository}`;
}
