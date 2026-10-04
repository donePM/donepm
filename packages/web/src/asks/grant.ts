import { describeRule, ruleWords, type PermissionRule, type RuleWords } from "@donepm/core";

/** What "Allow for this run" grants, in plain words; undefined when there is nothing to grant. */
export function grantText(rules: readonly PermissionRule[]): string | undefined {
  if (!rules.length) return undefined;
  return [...new Set(rules.map(describeRule))].join(", ");
}

/** The same, each rule once, split into words and pattern for the ask panel. */
export function grantWords(rules: readonly PermissionRule[]): RuleWords[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const key = describeRule(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(ruleWords);
}
