/**
 * Hosts whose WebFetch asks the daemon answers itself (issue #46, decision D31). Documentation and
 * release pages the agent reads while working. WebFetch is a GET without the user's credentials.
 */
export const DEFAULT_WEB_FETCH_DOMAINS: readonly string[] = [
  "github.com",
  "raw.githubusercontent.com",
  "docs.github.com",
  "nodejs.org",
  "developer.mozilla.org",
  "npmjs.com",
];

/** A list entry: a bare host name, lower case, no scheme, port or path. */
export function isDomain(value: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}

/** The host a WebFetch call reads from, or undefined when the input has no http(s) URL. */
export function webFetchHost(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const url = (input as Record<string, unknown>).url;
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (u.username || u.password) return undefined;
    return u.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The list entry that covers `host`: the domain itself or a subdomain of it. */
export function matchingDomain(host: string, domains: readonly string[]): string | undefined {
  return domains.find((d) => host === d || host.endsWith(`.${d}`));
}
