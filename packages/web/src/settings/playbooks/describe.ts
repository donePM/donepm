import type { PlaybookEntry } from "../../api/types";
import { slug } from "../repos/repos";

/** "global", "in owner/repo" or "overridden in owner/repo". */
export function originText(p: PlaybookEntry): string {
  return p.scope.kind === "global" ? "global" : `${p.overridesGlobal ? "overridden in" : "in"} ${slug(p.scope.origin)}`;
}

/** Where the file comes from: a shipped default, an edited one, the user's own, or a repository's. */
export function sourceText(p: PlaybookEntry): string {
  if (p.scope.kind === "repo") return `From the repository's .donepm/playbooks (${slug(p.scope.origin)})`;
  if (p.builtIn === "default") return "Built-in, unchanged";
  if (p.builtIn === "edited") return "Built-in, edited by you";
  return "Your own file";
}

/** Which items the playbook fits by its `match` (spec 8.3). */
export function matchText(match: PlaybookEntry["match"]): string {
  const parts: string[] = [];
  if (match?.source) parts.push(match.source === "github-pr" ? "pull requests (github-pr)" : match.source === "github-issue" ? "issues (github-issue)" : match.source);
  if (match?.labels?.length) parts.push(`labelled ${match.labels.join(" or ")}`);
  return parts.length ? parts.join(", ") : "every item";
}
