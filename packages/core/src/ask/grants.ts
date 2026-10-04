import { isQuestionTool } from "./question.js";
import { isRuleOfferable, type PermissionRule } from "./rules.js";
import { isForTool, type AskFlags } from "./session-rules.js";

/**
 * "Always allow" (decision D38): a rule the user allowed for every run in one repository. Stored by
 * donePM, never in Claude Code's settings files. A revoked grant stays stored for the events but
 * no longer matches.
 */
export interface PermissionGrant extends PermissionRule {
  id: string;
  /** Normalised origin of the repository (`github.com/owner/repo`), so every clone shares it. */
  repo: string;
  createdAt: string;
  /** The ask it was granted on, and that ask's item. */
  askId: string;
  itemId: string;
  /** The call it was granted for, in words (`Bash: pnpm test`). Kept after the item is purged. */
  call: string;
  useCount: number;
  lastUsedAt?: string;
  revokedAt?: string;
}

/** Exact match: the same tool and the same rule content, as Claude Code suggested it. */
export function sameRule(a: PermissionRule, b: PermissionRule): boolean {
  return a.toolName === b.toolName && (a.ruleContent ?? "") === (b.ruleContent ?? "");
}

/**
 * The grants that answer an ask, or undefined when the user has to. An ask is answered only when
 * Claude Code suggested at least one rule for the asked tool, none of them is blocked (D30), and
 * every one of them equals an active grant of the repository. A question for the user is never
 * answered, nor an ask whose flags want a decision for this call only.
 */
export function matchGrants(
  toolName: string,
  suggested: readonly PermissionRule[],
  flags: AskFlags,
  grants: readonly PermissionGrant[],
): PermissionGrant[] | undefined {
  if (isQuestionTool(toolName) || flags.suppressAlwaysAllowRule || flags.requiresUserInteraction) return undefined;
  const rules = suggested.filter((r) => isForTool(toolName, r));
  if (rules.length === 0 || !rules.every(isRuleOfferable)) return undefined;
  // A stored grant the block list covers never answers, whatever the database holds.
  const active = grants.filter((g) => g.revokedAt === undefined && isRuleOfferable(g));
  const used: PermissionGrant[] = [];
  for (const rule of rules) {
    const grant = active.find((g) => sameRule(g, rule));
    if (!grant) return undefined;
    if (!used.includes(grant)) used.push(grant);
  }
  return used;
}

/** `Bash(pnpm test *)`: the rule as Claude Code writes it in its settings. */
export function rawRule(rule: PermissionRule): string {
  return rule.ruleContent === undefined ? rule.toolName : `${rule.toolName}(${rule.ruleContent})`;
}

/** `github.com/owner/repo` → `owner/repo`; anything else as it is. */
export function repoName(origin: string): string {
  const parts = origin.split("/");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : origin;
}
