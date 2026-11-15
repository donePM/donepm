/**
 * Commands that reach a forge or tracker with the user's credentials, and `security`, which reads
 * the Keychain where API tokens live (D8, D50). Never in the agent's reach.
 */
export const BLOCKED_COMMANDS = ["gh", "glab", "jira", "az", "acli", "security"] as const;

/**
 * Defence in depth only (issue #170): `security` spelled out by path or behind a launcher. These
 * rules are bypassable (a copy of the binary, a symlink, `osascript`, a script that calls the
 * Security framework) and are not what keeps the Keychain closed. The agent's sandbox is: it denies
 * reading `~/Library/Keychains` (the daemon's agent settings, D50).
 */
export const SPELLED_OUT_KEYCHAIN_DENY_RULES = [
  "Bash(/usr/bin/security *)",
  "Bash(env security *)",
  "Bash(env /usr/bin/security *)",
  "Bash(/usr/bin/env security *)",
  "Bash(/usr/bin/env /usr/bin/security *)",
  "Bash(command security *)",
  "Bash(exec security *)",
  "Bash(xcrun security *)",
] as const;

/**
 * Deny rules passed via `--settings`, on top of the filtered `PATH` (spec 9.1). Both together:
 * the rules stop a command spelled out in Bash, the `PATH` stops it being found at all.
 */
export const DENY_RULES = [
  ...BLOCKED_COMMANDS.map((c) => `Bash(${c} *)`),
  "Bash(git push*)",
  ...SPELLED_OUT_KEYCHAIN_DENY_RULES,
] as const;

/**
 * A `read_only` playbook (D42) also loses every tool that writes files or reaches the web. Deny
 * beats any allow, a grant included.
 */
export const READ_ONLY_DENY_RULES = ["Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"] as const;

/**
 * What a `read_only` agent runs without a question: reading the history and the diff. Any other
 * Bash command asks the user, since the worktree holds code nobody vetted yet.
 */
export const READ_ONLY_ALLOW_RULES = ["Bash(git diff *)", "Bash(git log *)", "Bash(git show *)"] as const;

const BLOCKED_PATTERN = new RegExp(
  // At the start of the command or after a shell separator, possibly by path (`/usr/bin/gh`) or
  // behind `env`/`command`/`exec`/`sudo`/`xcrun`; `git push` with git's own options between the words too.
  String.raw`(^|[;&|(\x60\n]|\$\()\s*((env|command|exec|sudo|nohup|xargs|xcrun)\s+(-\S+\s+|\w+=\S*\s+)*)*([^\s;&|()]*/)?` +
    String.raw`(${BLOCKED_COMMANDS.join("|")}|git(\s+-\S+(\s+[^-\s]\S*)?)*\s+push)(\s|$|[;&|)])`,
);

/**
 * The blocked command a shell command line would run, if any: what an agent without donePM's deny
 * rules (Codex, issue #137) is refused by the daemon itself. A best effort on top of the filtered
 * `PATH`, which stays the real barrier: it catches what an agent writes plainly, not every way a
 * shell can be talked into running a program.
 */
export function blockedCommand(command: string): string | undefined {
  const m = BLOCKED_PATTERN.exec(command);
  if (!m) return undefined;
  const name = m[6]!;
  return name.startsWith("git") ? "git push" : name;
}
