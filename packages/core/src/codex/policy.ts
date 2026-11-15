import type { PermissionMode } from "../agent/capabilities.js";

/**
 * The built-in Codex permission profile donePM's own profile extends: `:read-only` reads anywhere
 * but writes nowhere, `:workspace` also writes in the thread's `cwd` (the worktree).
 */
export type CodexBaseProfile = ":read-only" | ":workspace";

export interface CodexPolicy {
  /** Codex asks before anything its sandbox does not allow, and the user answers (never `never`). */
  approvalPolicy: "on-request";
  /** The user reviews, not Codex's own reviewer agent. */
  approvalsReviewer: "user";
  /**
   * The sandbox, as a permission profile on the command line rather than a legacy `sandbox` mode on
   * `thread/start`: only a profile can deny reading a path (the Keychain, D50), and a `sandbox` or
   * `sandboxPolicy` in a request replaces the profile.
   */
  extends: CodexBaseProfile;
}

/**
 * A playbook's permission mode in Codex's terms (issue #137). The network is off in every mode:
 * a command that wants it asks. `default` asks before any write, as Claude Code's does;
 * `acceptEdits` lets Codex write inside the worktree without asking. A `read_only` playbook (D42)
 * is `default` with no web search. `plan` and `bypassPermissions` have no Codex counterpart that
 * keeps the network closed, so they are refused, never widened.
 */
export function codexPolicy(playbook: { permissionMode: PermissionMode; readOnly?: boolean }): CodexPolicy {
  const base = { approvalPolicy: "on-request", approvalsReviewer: "user" } as const;
  if (playbook.permissionMode === "plan" || playbook.permissionMode === "bypassPermissions") {
    throw new Error(`permission_mode ${playbook.permissionMode} is not available with codex`);
  }
  if (playbook.readOnly || playbook.permissionMode === "default") return { ...base, extends: ":read-only" };
  return { ...base, extends: ":workspace" };
}

/**
 * The playbook's model for Codex. Playbooks were written for Claude Code: a Claude model name
 * (`opus`, `sonnet`, `claude-…`) means nothing to Codex, so it uses its own default instead.
 */
export function codexModel(model: string | undefined): string | undefined {
  const m = model?.trim();
  if (!m) return undefined;
  if (/^(opus|sonnet|haiku|default|claude)([-\[.\d]|$)/i.test(m)) return undefined;
  return m;
}
