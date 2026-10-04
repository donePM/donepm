import { allowedPlaybooks, type Ingest } from "@donepm/core";
import type { IngestPlaybooks, PlaybookList } from "../../api/types";
import { playbookChoices, type PlaybookChoice } from "./repos";

const SOURCE = { issue: "github-issue", pr: "github-pr" } as const;

/**
 * The playbooks an ingest can be offered in a repository's settings (issue #153): any for issues,
 * only read-only ones for pull requests (D47). A configured name no file defines any more stays,
 * marked, so saving does not drop it unseen.
 */
export function ingestChoices(list: PlaybookList | undefined, origin: string, ingest: Ingest, configured: readonly string[] = []): PlaybookChoice[] {
  const readOnly = readOnlyNames(list, origin);
  const all = playbookChoices(list, origin);
  const choices = ingest === "pr" ? all.filter((c) => readOnly.has(c.name)) : all;
  const missing = configured.filter((n) => !all.some((c) => c.name === n)).map((n) => ({ name: n, label: `${n} (not found)` }));
  return [...choices, ...missing];
}

/** What the ingest offers now: the configured list, else the default (core `allowedPlaybooks`). */
export function ingestSelection(list: PlaybookList | undefined, origin: string, ingest: Ingest, configured: IngestPlaybooks | undefined): string[] {
  const own = configured?.[ingest];
  if (own) return [...own];
  return allowedPlaybooks(SOURCE[ingest], undefined, available(list, origin));
}

/**
 * The config entry for the form's choices: an ingest whose selection is its default is left out,
 * and so is the whole entry when both are.
 */
export function ingestConfig(list: PlaybookList | undefined, origin: string, selected: Record<Ingest, readonly string[]>): IngestPlaybooks | undefined {
  const out: IngestPlaybooks = {};
  for (const ingest of ["issue", "pr"] as const) {
    const fallback = ingestSelection(list, origin, ingest, undefined);
    const chosen = [...new Set(selected[ingest])].sort();
    if (chosen.join("\n") !== fallback.join("\n")) out[ingest] = chosen;
  }
  return out.issue || out.pr ? out : undefined;
}

function available(list: PlaybookList | undefined, origin: string) {
  const readOnly = readOnlyNames(list, origin);
  return playbookChoices(list, origin).map((c) => ({ name: c.name, readOnly: readOnly.has(c.name) }));
}

/** Names of the read-only playbooks this repository sees: its own replace global ones of the same name. */
function readOnlyNames(list: PlaybookList | undefined, origin: string): Set<string> {
  const byName = new Map<string, boolean>();
  for (const p of list?.playbooks ?? []) if (p.scope.kind === "global") byName.set(p.name, p.readOnly === true);
  for (const p of list?.playbooks ?? []) if (p.scope.kind === "repo" && p.scope.origin === origin) byName.set(p.name, p.readOnly === true);
  return new Set([...byName].filter(([, ro]) => ro).map(([n]) => n));
}
