import { GITHUB_COM } from "./host.js";

/** An item's `externalId`, split up. */
export interface ExternalRef {
  /** `github.com`, or the other GitHub host the id names. */
  host: string;
  /** `owner/repo` as GitHub spells it. */
  repository: string;
  number: number;
  /** What `gh --repo` takes: `owner/repo` on github.com, `host/owner/repo` on any other host. */
  repo: string;
}

const ID = /^(?:([^/#\s]+)\/)?([^/#\s]+\/[^/#\s]+)#(\d+)$/;

/**
 * `owner/repo#12` (github.com) or `github.acme.com/team/app#12` (any other GitHub host, issue #140).
 * Undefined for anything else.
 */
export function parseExternalId(externalId: string): ExternalRef | undefined {
  const m = ID.exec(externalId);
  if (!m) return undefined;
  const host = m[1]?.toLowerCase() ?? GITHUB_COM;
  const repository = m[2]!;
  return { host, repository, number: Number(m[3]), repo: m[1] ? `${host}/${repository}` : repository };
}
