import { defaultPlaybookFor, REVIEW_PLAYBOOK } from "../item/collect.js";
import type { ItemSource } from "../item/types.js";
import type { Playbook } from "./schema.js";

/** How an item came in: from the issue searches, or from the pull request searches (D40, D47). */
export type Ingest = "issue" | "pr";

export const INGESTS: readonly Ingest[] = ["issue", "pr"];

export const ingestOf = (source: ItemSource): Ingest => (source === "github-pr" ? "pr" : "issue");

/**
 * A repository's choice of playbooks per ingest (issue #153). A missing key means the default:
 * every playbook that is not read-only for issues, `review` for pull requests.
 */
export interface IngestPlaybooks {
  issue?: string[];
  pr?: string[];
}

/** The pull request default (D47): someone else's pull request is reviewed. */
export const DEFAULT_PR_PLAYBOOKS: readonly string[] = [REVIEW_PLAYBOOK];

type Available = Pick<Playbook, "name" | "readOnly">;

/**
 * The playbooks an item of `source` may run, among those its repository can load, sorted by name.
 * Pull requests only ever get read-only playbooks: donePM never pushes to someone else's branch
 * (D47), so a writing playbook named for them is left out. Issues get the configured ones, or every
 * playbook that is not read-only.
 */
export function allowedPlaybooks(source: ItemSource, configured: IngestPlaybooks | undefined, available: readonly Available[]): string[] {
  const names =
    ingestOf(source) === "pr"
      ? available.filter((p) => p.readOnly === true && (configured?.pr ?? DEFAULT_PR_PLAYBOOKS).includes(p.name))
      : configured?.issue
        ? available.filter((p) => configured.issue!.includes(p.name))
        : available.filter((p) => p.readOnly !== true);
  return [...new Set(names.map((p) => p.name))].sort();
}

/**
 * The playbook a newly collected item starts with: the repository's default for issues (issue
 * #127) when allowed, else the built-in default when allowed, else the first allowed one. With
 * nothing allowed (no playbooks loaded yet) the preference stands, so collecting never fails.
 */
export function initialPlaybook(source: ItemSource, preferred: string | undefined, allowed: readonly string[]): string {
  const fallback = defaultPlaybookFor(source);
  const wanted = ingestOf(source) === "issue" ? preferred : undefined;
  if (allowed.length === 0) return wanted ?? fallback;
  if (wanted !== undefined && allowed.includes(wanted)) return wanted;
  return allowed.includes(fallback) ? fallback : allowed[0]!;
}
