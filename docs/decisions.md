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

**D24. `core` uses the `yaml` package for playbook frontmatter.** It is well tested, widely used
and has no dependencies. A hand-rolled parser for the frontmatter subset would invite parser bugs
in a place where a mistake means a wrong model or permission mode. `core` may import `zod` and
`yaml`, nothing else.

**D25. Leftover changes are committed on approval, not refused.** When the user approves a PR
draft and the worktree still has uncommitted changes, the daemon runs `git add --all` and commits
them as "WIP from donePM" before `git push`. The diff the user reviewed already includes
uncommitted and untracked files (respecting `.gitignore`), so the pushed branch is exactly what was
approved. Refusing would send the user to a terminal for a step the daemon can do. The agent may
still commit on its own; the daemon only picks up what is left. Files that `.donepm/setup.yml`
copied into the worktree (`.env` and the like) are excluded from that commit: they are secrets
from the user's clone, not the agent's work.

**D26. Restart recovery resumes sessions and expires asks.** On start the daemon marks pending
permission asks `expired` (the CLI that asked is gone) and moves `running` items, and `needs_you`
items whose asks just expired, to `needs_you` with an `agent.interrupted` event. Items without a
session fail instead: there is nothing to resume. Resume, and a retry that reuses an existing
session and worktree, send "Continue where you left off." instead of the playbook prompt. A freshly
created worktree discards the old session, since the files it knew are gone.

**D27. Bash runs in Claude Code's sandbox; network asks go to the user.** Hiding `gh` from `PATH`
and denying `Bash(gh *)` does not stop `gh auth token`, `curl` with a token, or a script that
pushes. `--settings` therefore turns on the Bash sandbox with `allowUnsandboxedCommands: false`:
writes outside the worktree and tmp fail, and any network connection becomes a
`SandboxNetworkAccess` permission ask that the user answers like any other. There is no host
allowlist: a package registry that allows `npm install` also allows `npm publish`. The user's cache
directories (`~/Library/Caches`, `~/.cache`, `~/.npm`) stay writable so installs work.
`GH_CONFIG_DIR` and `GLAB_CONFIG_DIR` point at an empty directory. WebFetch and MCP servers are not
covered by the sandbox; they stay behind their normal permission asks.

**D28. The daemon may assign the issue on start; the opt-in and the click are the approval.**
"Drafts are the only way out" is about the agent. Assigning an issue to the user is a small outward
action the user asked for per repository (`assignOnStart`, default off) and triggers by pressing
Start, so it needs no draft. The daemon runs `gh issue edit --add-assignee @me`; the agent never
does. The outcome is recorded as `item.assigned` or `item.assign_failed`, and a failure does not
stop the agent. Which issues a repo collects (`sources`) lives in the user config, not in
`.donepm/`, because it is a personal choice and `.donepm/` is shared with contributors.

**D29. Homebrew tap, packed with `pnpm deploy`, run by `donepm install-service`.** A tap
(`donePM/homebrew-tap`) needs no review and updates from our release workflow; homebrew-core can
come once the project is stable. The tarball is `pnpm deploy --prod` of the cli, not a bundle:
there are no native dependencies, and the daemon reads files next to its code (`public/`, the
default playbook, the bridge script), which a bundler would have to be taught. The formula has no
`service do` block: `install-service` already exists, handles a daemon running outside launchd and
writes logs where `donepm status` expects them; two ways to run the same daemon would confuse.
The formula's caveats tell the user to run it, and to run it again after `brew upgrade`.

**D30. "Allow for this run" sends Claude Code's own suggestion, scoped to the session.** An ask
whose `can_use_tool` request carries `permission_suggestions` offers a second button next to Allow.
It answers allow with `updatedPermissions` set to the suggested `addRules` entries, with
`destination` forced to `session`. Nothing is written to the user's settings files, and nothing
outlives the agent's session. A rule that would cover a blocked command (`gh`, `glab`, `jira`,
`git push`) or all of Bash is never offered or sent. The `permission.answered` event records the
granted rules. Claude Code stores a network approval as a `WebFetch(domain:<host>)` rule, which
also covers WebFetch to that host, so the UI names both. D27 stands: there is still no standing
host allowlist; the user grants a host for one run. The doubled Bash and network ask seen on #41
was not a hook rewrite. Claude Code asks for a Bash command it cannot check statically ("A variable
in this command can't be checked before it runs", for example `for r in …; do curl …/$r; done`),
sends no suggestion for it, and then the sandbox asks for the host. The user's hooks stay loaded.

**D31. The daemon answers WebFetch asks for hosts on the user's list; no rules in `--settings`.**
WebFetch is a GET without the user's credentials, and the agent reads documentation and release
pages all the time; asking for each one trained the user to click Allow blindly (#46). The obvious
fix, `WebFetch(domain:…)` allow rules in `--settings`, is wrong: Claude Code uses the same rule for
the Bash sandbox's network, so `github.com` on the list would let `git push https://github.com/…`
or `curl -X POST` through without an ask and undo D27. Instead the daemon answers a WebFetch ask
whose host (or parent domain) is on `allowedWebFetchDomains` the moment it arrives and records
`permission.auto_allowed`. The default list holds GitHub and documentation hosts; an empty list
asks for every page. The cost is one round trip per fetch, which nobody sees.

**D32. A closed issue closes a never-started item; a started one waits for the user's Dismiss.**
An item whose issue is closed on GitHub used to stay on the board forever with a "closed upstream"
badge, and a `ready` item had no way out (#44). A `ready` item without worktree or agent session has
no work to lose, so the poll moves it to Done itself (`item.closed_upstream`). A started item may
hold commits, drafts or a session the user still wants, so it keeps the badge and the card offers
Dismiss, which moves it to Done (`item.dismissed`). Dismiss is refused while the agent runs; the
user stops it first. Neither touches the worktree: removing it stays the user's button.

**D33. A merged PR's worktree may go on its own, if the user opted in and nothing would be lost.**
D13 keeps a worktree until its PR is merged; after that it only holds disk space and a stale
checkout, and users forgot to press Remove (#47). With `removeWorktreeOnMerge` on (default off),
each poll asks `gh pr view` for every done item that still has a worktree and an executed PR draft,
until the PR is merged. Merged → the daemon removes the worktree with the same git call as the
button and keeps the branch (`worktree.removed`, actor `system`, reason `pr_merged`). As with D28,
turning the setting on is the user's approval; the PR state is a read and sends nothing out. The
daemon never removes a worktree with uncommitted or untracked changes: it records
`worktree.remove_skipped` once and the card says why; the next poll after the user cleans up removes
it. Files that `.donepm/setup.yml` copied in (D25) do not count, since the setup copies them again.
With the setting off the daemon only records `item.pr_merged` once, and the card says "PR merged".
A worktree whose agent is running is never touched.

**D34. A new worktree gets its dependencies from the main clone by copy-on-write, else the daemon
installs them.** Dependencies are gitignored, so `git worktree add` does not bring them, and the
agent has no network to install them (D27). Agents worked around it by symlinking the main clone's
`node_modules` (#78): writes then land in the main clone, and pnpm refuses a symlinked hoist
directory. Setup now detects the package managers from the lockfiles in the root (pnpm, bun, yarn,
npm: one of them, in that order; Composer next to it). When the main clone has the same lockfile and
its dependencies, the daemon clones every `node_modules` (one per workspace package) or `vendor`
copy-on-write (`cp -c` on APFS, `--reflink=auto` on Linux): seconds and no extra disk for 262 MB.
Otherwise it runs the manager's frozen install in the worktree; the daemon may use the network, the
agent still may not. Only gitignored directories are filled, so a committed `vendor/` stays as git
left it. `dependencies: off` in `.donepm/setup.yml` turns the step off for repos whose `run`
installs on its own terms. Bloom has no such step: its users write a setup script per repo.

**D35. An opened PR waits for its CI; red CI goes back to the user, and fixes leave by a push
draft.** A PR with red CI was "done" on the board and nobody noticed (#62). After `draft pr` runs,
the item is `checking` (In Progress, no agent) and each poll reads `gh pr checks`. All checks count,
not only required ones: a red optional check is still something the user wants to see, and "Mark
done" is one click. The verdict waits until every check finished, so the card shows all failures at
once. A PR with no checks after 60 s has no CI and is done; within those 60 s it may just not have
registered them. Red → `needs_you` with the failed checks and the tail of their logs, fetched by the
daemon, because the agent cannot reach GitHub (D27). The user picks: the agent fixes it (resumed with
the failures and logs as message), rerun the failed jobs (flaky), or mark done. The agent's fix
leaves through a new draft type `push` (`draft_push`), allowed wherever `pr` is, since it only adds
commits to the PR the user already approved; the daemon fills in the commits from git, the agent
gives a summary. Pushing stays a daemon action after approval, as every outward effect. Bloom does
not watch CI.

**D36. donePM watches its open PRs for merge conflicts; the user picks who resolves one.** PR #75
sat green but unmergeable after main moved, and only the user's look at GitHub found it (#77). The
PR poll (D33) now also asks for `mergeable` on `done` and `checking` items. Only `CONFLICTING`
counts: `UNKNOWN` means GitHub has not computed it yet and comes after every push to the base, so
acting on it would flap. A conflict moves the item to `needs_you` once, with the files from `git
merge-tree` against the fetched base, since GitHub does not list them. The user picks: the agent
resolves it (the daemon fetches the base first, the agent has no network; it merges instead of
rebasing, so the fix leaves as a plain `draft_push` (D35) without force-pushing over what the user
approved), or "I'll do it myself", which returns the item and leaves a quiet note. Either way the
conflict ends when GitHub reports the PR mergeable, merged or closed, and a still-waiting item goes
back where it was. Bloom does not watch PRs.

## Open (not decided)

- Whether the playbook should tell the agent to commit. D25 covers what it leaves behind.
- Jira Cloud vs Server auth details. Decide when the Jira adapter starts.
- Team/server component. Not before a second user asks.
