import type { PlaybookList, RepoView, SourcePollStatus } from "../../api/types";

/** `owner/repo` of a `host/owner/repo` origin. */
export const slug = (origin: string): string => origin.split("/").slice(1).join("/");

/**
 * The table's rows: managed repositories, and ignored (unmanaged) ones only when asked for (D46),
 * narrowed by the filter on the origin or the path.
 */
export function visibleRepos(repos: readonly RepoView[], filter: string, showIgnored: boolean): RepoView[] {
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return repos.filter(
    (r) => (showIgnored || r.managed) && words.every((w) => r.originUrl.toLowerCase().includes(w) || r.path.toLowerCase().includes(w)),
  );
}

export interface PlaybookChoice {
  name: string;
  label: string;
}

/**
 * The playbooks a repository's new issues can start with: its own, then the global ones it does
 * not replace. "implement · opus (global)".
 */
export function playbookChoices(list: PlaybookList | undefined, origin: string): PlaybookChoice[] {
  if (!list) return [];
  const own = list.playbooks.filter((p) => p.scope.kind === "repo" && p.scope.origin === origin);
  const replaced = new Set(own.map((p) => p.name));
  const global = list.playbooks.filter((p) => p.scope.kind === "global" && !replaced.has(p.name));
  return [
    ...own.map((p) => ({ name: p.name, label: `${p.name} · ${p.model} (this repository)` })),
    ...global.map((p) => ({ name: p.name, label: `${p.name} · ${p.model} (global)` })),
  ];
}

/** The line under a repository's query: how its last poll went. */
export function pollLine(poll: SourcePollStatus | undefined): { text: string; failed: boolean } | undefined {
  if (!poll) return undefined;
  if (!poll.ok) return { text: `query failed · ${poll.error ?? "unknown error"}`, failed: true };
  const n = poll.issues ?? 0;
  return { text: `last poll ok · ${n} ${n === 1 ? "issue" : "issues"}`, failed: false };
}

/** An orphan's path below the worktree root it lives under, or the whole path. */
export function orphanName(path: string, roots: readonly string[]): string {
  for (const root of roots) {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (path.startsWith(prefix)) return path.slice(prefix.length);
  }
  return path;
}
