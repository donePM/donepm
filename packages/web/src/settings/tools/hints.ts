import type { CliState, HelperStatus } from "../../api/types";

export interface CliHint {
  label: string;
  /** `muted`: missing, but optional. */
  tone: "ok" | "warn" | "muted";
  /** What blocks, in one sentence; absent when ready. */
  why?: string;
  /** Copyable command that fixes it. */
  command?: string;
}

/**
 * Spec §6.1: `brew install gh` / `gh auth login` as copyable hints. With a `host`, for a GitHub host
 * other than github.com (issue #140): logging in names it.
 */
export function ghHint(state: CliState, host?: string): CliHint {
  switch (state) {
    case "ready":
      return { label: "ready", tone: "ok" };
    case "not_installed":
      return { label: "not installed", tone: "warn", why: "Issues cannot be collected until gh is installed. Run this in a terminal, then check again:", command: "brew install gh" };
    case "not_logged_in":
      return host
        ? { label: "found, not logged in", tone: "warn", why: `Work on ${host} cannot be collected until gh is logged in there. Run this in a terminal, then check again:`, command: `gh auth login --hostname ${host}` }
        : { label: "found, not logged in", tone: "warn", why: "Issues cannot be collected until gh is logged in. Run this in a terminal, then check again:", command: "gh auth login" };
  }
}

export function claudeHint(state: CliState): CliHint {
  switch (state) {
    case "ready":
      return { label: "ready", tone: "ok" };
    case "not_installed":
      return { label: "not installed", tone: "warn", why: "Agents cannot start until Claude Code is installed. Run this in a terminal, then check again:", command: "curl -fsSL https://claude.ai/install.sh | bash" };
    case "not_logged_in":
      return { label: "found, not logged in", tone: "warn", why: "Agents cannot start until the CLI is logged in. Run this in a terminal, then check again:", command: "claude auth login" };
  }
}

/** A helper is optional: missing is muted, not a warning. */
export function helperHint(found: HelperStatus | undefined, install: string): CliHint {
  if (found?.installed) return { label: "installed", tone: "ok" };
  return { label: "not installed", tone: "muted", why: "Optional. To let agents use it, run this in a terminal, then check again:", command: install };
}

/** The status dot for a tool: green when ready, amber when something needs fixing, grey while unknown or optional. */
export function hintDot(hint: CliHint | undefined): "ok" | "attn" | "off" {
  if (!hint) return "off";
  return hint.tone === "ok" ? "ok" : hint.tone === "warn" ? "attn" : "off";
}
