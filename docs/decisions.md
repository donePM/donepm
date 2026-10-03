# Decisions

Decisions made before the first line of code, with the reason. Change one only with a new entry
that says why. Date: 2026-10-03.

## Product

**D1. Work comes from sources, not from prompts.** The task is already written in the ticket. The
user clicks, the agent reads the ticket. This is the main difference to Bloom, Conductor, Codex
and Copilot Coding Agent, which all start at a prompt.

**D2. Every outward action is a draft the user approves.** PR, comment, merge, ticket: the agent
creates a draft through an MCP tool, the daemon executes it after approval. Reason: "human in
control" must be a property of the architecture, not of the prompt. It also lets the user batch
approvals instead of answering one permission prompt per call.

**D3. Reviews are drafts too, never posted directly.** The user's tone is the user's. The
review agent has read tools and `draft_review_comment` only. It cannot write code.

**D4. Agent count starts at 1 and stretches per item with user approval.** No global slider. An
agent that wants to parallelise asks; the budget rises for that item and falls back after.
(Post-MVP.)

**D5. MVP is GitHub only, one playbook, the full loop.** Issue → worktree → agent → draft PR →
approve → `gh pr create`. Jira, review, review feedback, schedules, Dependabot and logs come
after, in that order. Reason: the implement path needs all the infrastructure; everything else is
another playbook on top of it.

**D6. Log analysis is nice to have.** If the rest runs automatically, a human can do logs with
focus.

## Architecture

**D7. Local first. A server is optional and later.** Company ticket systems sit behind VPN and
SSO, unreachable from a SaaS. Ingest and agents must run where the developer sits. The domain
module keeps an append-only event log so a later server is a sync, not a rewrite.

**D8. Sources are accessed through logged-in CLIs (`gh`, later `glab`, `jira`).** They already
work behind the developer's VPN and SSO. donePM stores no tokens. Token login is a fallback behind
the same adapter interface.

**D9. Agents must not reach `gh`, `glab`, `jira` or `git push`.** Filtered `PATH` plus deny rules
in the session, both. Otherwise Claude Code will use `gh` the moment it sees the binary and bypass
the draft gate.

**D10. Playbooks instead of personas.** A playbook is a Markdown file with frontmatter: model,
effort, permission mode, allowed drafts, match rules, task body. Global and per-repo
(`.donepm/playbooks/`). "Review specialist" is the review playbook. Specialisation inside a turn
uses Claude Code's own subagents (`.claude/agents/`), not donePM.

**D11. Playbook selection: rules first, classifier second.** Exactly one `match` → use it. Several
or none → a cheap classifier proposes one; the user can change it in a dropdown on the card. The
classifier is behind an interface (`choosePlaybook`) with swappable providers (rules only, jev.ai,
Claude). Reason: VPN reachability and data privacy differ per user; and the provider must be
measurable via the `item.playbook_changed` event.

**D12. Worktrees live in their own space**, `~/.local/share/donepm/worktrees/<repo>/<branch>/`,
never inside the repo. Repos are found by scanning one root folder (depth 4) and matched to issues
by normalised `origin` URL.

**D13. Worktree is kept until the PR is merged.** Review feedback resumes the same agent session
(`--resume`) in the same worktree. Removing early would throw away the agent's context.

**D14. Append-only event log per item.** Every human and agent decision is an event with timestamp
and actor. The card shows it as a timeline. Needed for traceability and for later sync.

## Technology

**D15. TypeScript, not Rust.** The Claude Agent SDK is TypeScript, the stream-json protocol is
already handled there, `gh`/Jira clients exist on npm. Learning Rust and designing a product at the
same time is two projects. Rust may come later for a small isolated tool.

**D16. Web UI, not TUI.** The main job is reading: diffs, comments next to code, transcripts. That
is bad in a terminal. Vue is already known. A TUI would be thrown away; the web UI can later be
wrapped as a Safari web app or a thin WKWebView shell with no rewrite.

**D17. Daemon + web UI on localhost, not Electron or Tauri.** Start with the browser. Add a Safari
web app ("Add to Dock") when a Dock icon is wanted, a Swift WKWebView shell when notifications or a
menubar icon are wanted, Tauri only if Linux/Windows are needed.

**D18. Node daemon under launchd, SQLite via `node:sqlite`.** One long-running process, children
managed explicitly, `KeepAlive`. No PHP/Laravel: the daemon must hold processes and sockets open.

**D19. Vue 3 for the UI.**

**D20. Port 6174.** Kaprekar's constant: every four-digit number ends up there. Unregistered as far
as we know; verify against IANA and keep it configurable.

**D21. Monorepo with pnpm workspaces: `core`, `daemon`, `web`, `cli`.** `core` has no I/O and
imports nothing from the others, so behaviour is testable without a running daemon. Same split as
Bloom's `BloomCore` / app target.

**D22. MCP bridge as a stdio shim over a unix socket**, like Bloom. The shim is a line relay with
no logic, so it cannot drift from the daemon. `--mcp-config` is a file (0600), never inline JSON,
because argv is visible in `ps`.

**D23. Playbooks are files from the MVP on**, with `model` in the frontmatter. One built-in
`implement.md` written to `~/.config/donepm/playbooks/` on first start.

## Open (not decided)

- Whether the agent commits or the daemon commits before push. Decide after first live runs.
- Jira Cloud vs Server auth details. Decide when the Jira adapter starts.
- Team/server component. Not before a second user asks.
