import { rawRule, repoName, ruleWords, type PermissionGrant, type RuleWords } from "@donepm/core";

export interface GrantRow {
  id: string;
  /** "Bash commands matching" `pnpm test *`. */
  words: RuleWords;
  /** `Bash(pnpm test *)`, as Claude Code writes the rule. */
  raw: string;
  createdAt: string;
  useCount: number;
  lastUsedAt?: string;
  /** The call it was granted for (`Bash: pnpm test`). */
  call: string;
}

export interface GrantGroup {
  repo: string;
  /** `owner/repo`. */
  name: string;
  rows: GrantRow[];
}

/** "Always allowed" in Settings (D38): one group per repository, by name; rows oldest first. */
export function groupGrants(grants: readonly PermissionGrant[]): GrantGroup[] {
  const groups = new Map<string, GrantGroup>();
  const sorted = [...grants].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const g of sorted) {
    if (g.revokedAt !== undefined) continue;
    let group = groups.get(g.repo);
    if (!group) groups.set(g.repo, (group = { repo: g.repo, name: repoName(g.repo), rows: [] }));
    group.rows.push({
      id: g.id,
      words: ruleWords(g),
      raw: rawRule(g),
      createdAt: g.createdAt,
      useCount: g.useCount,
      ...(g.lastUsedAt ? { lastUsedAt: g.lastUsedAt } : {}),
      call: g.call,
    });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "never used", "used once", "used 4 times". */
export function usesText(count: number): string {
  if (count === 0) return "never used";
  return count === 1 ? "used once" : `used ${count} times`;
}
