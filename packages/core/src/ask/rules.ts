import { BLOCKED_COMMANDS } from "./deny-list.js";

/** A Claude Code permission rule: `WebFetch(domain:github.com)` is `{ toolName: "WebFetch", ruleContent: "domain:github.com" }`. */
export interface PermissionRule {
  toolName: string;
  /** Absent for a rule that covers every call of the tool. */
  ruleContent?: string;
}

/** Read rules out of untrusted JSON (the CLI's suggestions, a stored column). Malformed entries are dropped. */
export function parseRules(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) return [];
  const rules: PermissionRule[] = [];
  for (const v of value as unknown[]) {
    if (typeof v !== "object" || v === null) continue;
    const { toolName, ruleContent } = v as Record<string, unknown>;
    if (typeof toolName !== "string" || !toolName) continue;
    if (ruleContent === undefined) rules.push({ toolName });
    else if (typeof ruleContent === "string") rules.push({ toolName, ruleContent });
  }
  return rules;
}

/** Plain words for the UI. */
export function describeRule(rule: PermissionRule): string {
  const content = rule.ruleContent?.trim();
  if (!content) return `all ${rule.toolName} calls`;
  // Claude Code uses WebFetch(domain:…) for the web tool and for the Bash sandbox's connections.
  if (rule.toolName === "WebFetch" && content.startsWith("domain:")) {
    return `web and network access to ${content.slice("domain:".length)}`;
  }
  return `${rule.toolName}: ${content}`;
}

/** Commands whose Bash rules we never grant, even if a pattern is broad enough to cover them. */
const SAMPLES = [...BLOCKED_COMMANDS.map((c) => `${c} x`), "git push", "git push origin main"];

/** A Bash rule is a glob over the command line; the legacy `cmd:*` form means `cmd *`. */
function globMatches(content: string, command: string): boolean {
  const glob = content.replace(/:\*$/, " *");
  const source = glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`).test(command);
}

const basename = (word: string) => word.slice(word.lastIndexOf("/") + 1);

/**
 * Whether a rule may be granted for a run. Refuses anything that would allow a command on the deny
 * list (`gh`, `glab`, `jira`, `git push`) and any rule that covers every Bash command. The deny rules
 * still win inside Claude Code; this keeps us from offering a grant that contradicts them.
 */
export function isRuleOfferable(rule: PermissionRule): boolean {
  if (rule.toolName !== "Bash") return true;
  const content = rule.ruleContent?.trim();
  if (!content || /^\*+$/.test(content)) return false;
  const words = content.split(/[\s:*]+/).filter(Boolean);
  const first = basename(words[0] ?? "");
  if ((BLOCKED_COMMANDS as readonly string[]).includes(first)) return false;
  if (content.startsWith("git push")) return false;
  return !SAMPLES.some((s) => globMatches(content, s));
}

export const offerableRules = (rules: readonly PermissionRule[]): PermissionRule[] => rules.filter(isRuleOfferable);
