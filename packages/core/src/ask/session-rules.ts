import { offerableRules, type PermissionRule } from "./rules.js";

/**
 * Undocumented flags on a `can_use_tool` request. Either one means Claude Code wants a decision for
 * this call only: no rule for the rest of the run (Bloom's `PermissionAsk.swift`).
 */
export interface AskFlags {
  suppressAlwaysAllowRule: boolean;
  requiresUserInteraction: boolean;
}

/** Read the flags from the raw request. Missing, unknown or not `true` means false. */
export function askFlags(request: unknown): AskFlags {
  const r = typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
  return {
    suppressAlwaysAllowRule: r.suppress_always_allow_rule === true,
    requiresUserInteraction: r.requires_user_interaction === true,
  };
}

/**
 * Whether a suggested rule belongs to the asked tool. The sandbox's network ask is answered with a
 * `WebFetch(domain:…)` rule, which Claude Code uses for both (spec 9.4).
 */
export function isForTool(toolName: string, rule: PermissionRule): boolean {
  if (rule.toolName === toolName) return true;
  return toolName === "SandboxNetworkAccess" && rule.toolName === "WebFetch" && (rule.ruleContent ?? "").trim().startsWith("domain:");
}

/**
 * The rules "Allow for this run" may grant for an ask (spec 9.4, D30): none when a flag says so,
 * otherwise the suggested rules for the asked tool that pass the block list.
 */
export function sessionRules(toolName: string, suggested: readonly PermissionRule[], flags: AskFlags): PermissionRule[] {
  if (flags.suppressAlwaysAllowRule || flags.requiresUserInteraction) return [];
  return offerableRules(suggested.filter((r) => isForTool(toolName, r)));
}
