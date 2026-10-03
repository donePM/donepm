import { describeRule, type PermissionRule } from "@donepm/core";

/** What "Allow for this run" grants, in plain words; undefined when there is nothing to grant. */
export function grantText(rules: readonly PermissionRule[]): string | undefined {
  if (!rules.length) return undefined;
  return [...new Set(rules.map(describeRule))].join(", ");
}
