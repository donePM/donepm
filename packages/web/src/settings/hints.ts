import type { CliState } from "../api/types";

export interface CliHint {
  label: string;
  tone: "ok" | "warn";
  /** What blocks, in one sentence; absent when ready. */
  why?: string;
  /** Copyable command that fixes it. */
  command?: string;
}

/** Spec §6.1: `brew install gh` / `gh auth login` as copyable hints. */
export function ghHint(state: CliState): CliHint {
  switch (state) {
    case "ready":
      return { label: "ready", tone: "ok" };
    case "not_installed":
      return { label: "not installed", tone: "warn", why: "Issues cannot be collected until gh is installed. Run this in a terminal, then check again:", command: "brew install gh" };
    case "not_logged_in":
      return { label: "found, not logged in", tone: "warn", why: "Issues cannot be collected until gh is logged in. Run this in a terminal, then check again:", command: "gh auth login" };
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

/** The status dot for a tool: green when ready, amber when something needs fixing, grey while unknown. */
export function hintDot(hint: CliHint | undefined): "ok" | "attn" | "off" {
  if (!hint) return "off";
  return hint.tone === "ok" ? "ok" : "attn";
}
