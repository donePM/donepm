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

**D37. Finished items are muted, archived after 24 h and deleted after 7 days; events go with
their item.** The Done column only grew, and finished cards looked like ones still needing a look
(#63). Finished means `done` and, if a draft opened a PR, that PR merged; a done item without a PR
(closed upstream, dismissed, marked done) has nothing left in git and is finished when it became
done. A PR closed without merge never finishes the item; the user deals with it. Finished cards are
muted and offer nothing but opening them. After `archiveAfterHours` (default 24, 0 = at once) the
poll archives the item: an `item.archived` event and a flag, no new state, because an archived item
is still done and its detail page must read as before. Items waiting on a draft or an ask stay. To
see the merge of an item whose worktree the user already removed, the PR watch now also polls done
items without a worktree until the merge is recorded. After `deleteAfterDays` (default 7, null =
never) an archived item without a worktree is deleted with its events, drafts, asks and transcript.
This amends "append-only events": events are never updated, and deleted only with their whole item.
Keeping them forever would keep transcripts of tens of MB per item for nothing the user asked for,
and an event log of a deleted item has nothing to point to. A database trigger refuses deleting the
events of an item that is not archived. The purge is logged by the daemon, not recorded as an event.
A purged item leaves a tombstone, so its still-open issue is not collected again the next poll. A
reopened issue (an archived item flagged closed upstream, or a closed tombstone, seen open again)
becomes a **new** item rather than unarchiving the old one: unarchiving would bring back old PR and
merge events, so the item would count as finished at once and leave again, and the new work deserves
a fresh run. External ids are unique among live items only. Bloom has no board to clear.

**D38. "Always allow" is per repository, stored by donePM and answered by the daemon on every ask.**
Allowing `pnpm test` again in every run was the next thing that trained the user to click blindly
(#72). Claude Code's own answer, `localSettings` or `userSettings` as the destination, would write
into the clone's `.claude/settings.local.json` or the user's settings: a file donePM does not own,
that every other session in that clone would obey, and that no list in donePM could show or take
back. Instead donePM stores a grant per repository (the normalised origin, so every clone and every
item of the repo shares it) in `permission_grants`, and the daemon answers a later ask itself with a
**plain** allow, never `updatedPermissions`. The CLI keeps asking, so every ask reads the grants
again and a Remove in Settings applies at once, also to agents already running. An ask is answered
only when every rule Claude Code suggested for the asked tool equals an active grant exactly (tool
and rule content; no glob reasoning of our own), none of them is blocked (D30's list: `gh`, `glab`,
`jira`, `git push`, all of Bash), no `suppress_always_allow_rule` or `requires_user_interaction`
flag is set and it is not an `AskUserQuestion`. A blocked rule can never be granted, and a blocked
grant that somehow sits in the database never matches. An ask without suggestions keeps asking.
Answers are recorded like D31's (`permission.auto_allowed`, the payload naming the grants), and
granting and removing are events too. A removal sets `revoked_at`; the row stays. Grants have no
foreign key to the item or ask they were made on, because they outlive D37's purge; the call they
were granted for is kept as text. Bloom offers "always" by writing Claude Code's settings.

**D39. donePM reads review feedback on its own PRs, reopens the item, and answers only through
drafts.** A PR donePM opened could collect "please rename this" for days while its card sat in
Done (#48). The PR watch (D33, D36) already runs `gh pr view` per open PR; for a `done` item whose
PR is open it now also reads reviews and comments with one GraphQL call, at the same poll interval,
so there is no second clock. Feedback is a review that requests changes or comments with a body,
its inline comments, and conversation comments, from anyone but the PR's author and never from a
bot: the author is the user, so donePM's own replies never count as feedback, and bots (CI
summaries, coverage, Dependabot) would reopen the item after every push. Approvals are not
feedback. "New" means a `kind:id` no earlier `pr.feedback` recorded, so feedback that arrives while
the agent works or CI runs is picked up once the item is done again, and nothing is reported twice.
The **old item is reopened** (`done` → `needs_you`), not a new one made: the worktree, branch,
session and PR are all there, and the agent remembers why it wrote the code. The user picks
"Address with agent" (resume, reason `pr_feedback`, like D35's "Fix with agent") or "Mark done".
Answers to reviewers are outward effects, so they are drafts like everything else (D2): `draft_push`
takes optional `replies`, posted by the daemon right after the push, after which D35's CI wait
applies unchanged; `draft_comment` carries only replies when no code changes, and its item goes
straight back to `done` since nothing was pushed. Both are allowed wherever `pr` is, like
`draft_push`. A reply's `inReplyTo` must be a thread the feedback brought in, so the agent cannot
post onto an arbitrary comment. Each posted reply is stored at once, so a retry after a half-failed
post never posts a reply twice. Red CI after done is not feedback; D35 owns CI. On the first poll
after this ships, done items with open PRs that already have reviews will surface them; that is
deliberate, they are unaddressed feedback. Bloom does not watch PRs.

**D40. Review requests are a second GitHub source, `github-pr`, on the same poll.** Pull requests
that ask for the user's review were the other half of #48. Each poll also runs
`gh search prs --review-requested=@me --state=open` with the same fields as the issue search, so the
answer goes through the same schema and upsert; the item's `source` is `github-pr`, its
`externalId` `owner/repo#N` like an issue's (issue and PR numbers share one sequence per repo, so
they cannot collide), and its default playbook is `review` (8.1). Repos the user does not manage
(D46) stay off the board as for issues. A failing PR search is a failing source: the issues still come in, and
nothing is checked for "closed upstream" (6.2). Closed and merged PRs are found with the existing
`gh issue view --json state`, which answers `MERGED` for a merged PR; the daemon reads it as
closed, so D32 applies unchanged and an untouched review request that someone else merged goes to
Done on its own. A PR whose review request was withdrawn but which stays open is not detected: the
search no longer lists it, and confirming it would need a call per item. Assign on start (6.4) is
skipped, it is someone else's PR. An old `gh` without `search prs` means no review requests, not an
error. A review request that arrives again after the item is done does not reopen it; the user
starts a new review from GitHub or waits for a later version of this.

**D41. A review runs in its own worktree on the PR's head, fetched by ref, with no setup.**
`gh pr view` gives the base (`baseRefName`, else the repo's default). The daemon fetches
`origin <base>` and `+refs/pull/<n>/head:refs/donepm/pull/<n>` in one `git fetch` and adds the
worktree on a new local branch `<prefix>review-<n>-<slug>` at that ref. `refs/pull/<n>/head` exists
on the base repo for forks too, so no remote per contributor is needed, and the private
`refs/donepm/` namespace keeps it out of the user's branches and tags. The base is stored on the
item (`baseBranch`, a new column) because the diff in the UI, the prompt (`{{ base }}`) and the
inline-comment check all compare against it, not against the default branch. No `setup.yml` and
no dependency install (7.3) run for a review: installing runs the PR author's scripts before
anybody has read them. A PR that is no longer open when Start is pressed is refused before
anything is created. Removing the worktree stays the user's button (7.4).

**D42. A read-only playbook gets no write tools, no project settings and no standing grants.**
Reviewing means running an agent inside code nobody has vetted, so the review playbook sets
`read_only: true`, which requires `permission_mode: default` and forbids the `pr` draft. For such a
run the daemon adds deny rules for `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `WebFetch` and
`WebSearch`, allow rules only for `Bash(git diff *)`, `Bash(git log *)` and `Bash(git show *)`,
turns off the sandbox's `autoAllowBashIfSandboxed` so every other command asks the user, and
passes `--setting-sources user`, so the PR's `.claude/settings.json`, its hooks and its
`.mcp.json` enablement are not loaded (hooks would run the author's commands without asking). The
user's own MCP servers keep working; `--strict-mcp-config` stays off (9.1). "Always allow" grants
(D38) are not applied in a read-only run: a grant made for implementing in a repo is no reason to
let a stranger's PR run the same command. The PR's `CLAUDE.md` is still read by Claude Code as
memory; the playbook tells the agent to treat everything in the worktree as material to review,
not as instructions. Reads (`Read`, `Grep`, `Glob`) inside the worktree need no permission in
Claude Code and stay open.

**D43. A review draft is one review: verdict, summary and inline comments, posted in one call.**
D3 named a `draft_review_comment` tool; a review on GitHub is one object with a verdict and many
comments, and posting comments one by one would notify the author once per comment, so the tool
is `draft_review { verdict, body, comments? }` with `verdict` `APPROVE`, `REQUEST_CHANGES` or
`COMMENT` and comments `{ path, line, body }`. The daemon adds the PR number, URL and the commit it
reviewed (`git rev-parse HEAD` in the worktree), so the comments land on the lines the agent read
even if the author pushes meanwhile. Every comment's line must be on the new side of a hunk of
`git diff origin/<base>...HEAD`, parsed with the `diff` package; GitHub would refuse anything else
with a 422 after the user approved. A summary is required except for `APPROVE`. After approval the
daemon posts it with one `gh api --method POST repos/<o>/<r>/pulls/<n>/reviews --input <file>`
(0600 temp file, like other bodies), all comments on the `RIGHT` side. Once gh exits 0 the review
counts as posted even if its answer cannot be parsed, so a Retry never posts it twice. The item is
`done` after posting (`reviewPosted`), and a later push by the author is not followed up. Like the
push and comment drafts (D35, D39) it is not edited in the UI: the user approves it or rejects it
with a reason the agent works in. The playbook allows only `review`, so `draft_pr`, `draft_push`
and `draft_comment` are not offered. Comments on removed lines (`LEFT`) and multi-line ranges are
left for later.

**D44. A new worktree root offers to move the old worktrees with `git worktree move`; the agent
session stays.** Changing `worktreeRoot` used to strand existing worktrees and hide their orphans.
Now the settings save asks first (409 with the list) and the user chooses move or leave (spec 7.1).
Move uses `git worktree move`, not a filesystem rename, so git's `.git/worktrees/<name>` metadata
and the worktree's `.git` file stay consistent. A worktree with a running agent is never moved (the
process's cwd would vanish under it); it is skipped with a reason, as are a missing worktree, an
existing target and any git failure. No overwrite, no force. Review worktrees (D41) live under the
same root and are treated alike. On the session: Claude Code files a session under
`~/.claude/projects/<encoded cwd>/`, but `claude -p --resume <id>` finds it by id from any cwd
(checked on Claude Code 2.1.289: resumed from an unrelated directory, same session id). So the
item keeps `agentSessionId`, no file under `~/.claude` is moved or copied, and resumable items are
not skipped; the next resume simply runs in the new directory. Should a later Claude Code tie
resume to the cwd, the remedy is a fresh session, not moving its files. Former roots are kept in
config (`previousWorktreeRoots`) and searched for orphans until nothing under them is left, so
"leave" does not hide worktrees from Settings.

**D45. Priority comes from GitHub's "Priority" issue field, labels are the fallback; changes are
events; items outside the poll are not refreshed.** A priority set on GitHub did not reach the
board (#95). Looking at the user's assigned issues on 2026-10-04: no priority labels anywhere, and
an organization (`clonio-dev`) with GitHub's organization-level issue field "Priority" (options
Urgent, High, Medium, Low) set on its issues. That is where the user sets it, so donePM reads it.
The other two places were checked and are not read: the issue type (Feature, Task, …) says what
kind of work it is, not how urgent; a Projects v2 "Priority" field needs the `read:project` scope,
which a default `gh auth login` token does not have (the query fails with `INSUFFICIENT_SCOPES`),
and asking users to widen their token for a sort order is out of proportion. `gh search issues
--json` cannot return issue fields, so the poll asks for the node `id` and reads the fields of all
polled issues with one `gh api graphql` `nodes(ids:)` call per 100 issues (a few GraphQL points per
poll), not one call per issue. Option names map to tiers (Urgent/Critical 0, High 1,
Medium/Normal 2, Low 3, also `P0`..`P3`); an unknown option or no field falls back to the labels,
which keep working for repositories that use them. If the lookup fails, known items keep their
priority: falling back to the labels for one poll would move cards back and forth and write two
events for nothing. A changed priority, title or label set is an `item.refreshed` event (actor
`system`) listing only what changed as `{ from, to }`, so the timeline can tell why a card moved;
body edits are noise and change silently. The card shows the tier as a badge unless it is the
default P2. Items the poll does not return are not refreshed: `done` and archived items are
finished and their card is muted, and an item no longer assigned or matching its query left the
user's scope; refreshing them would need a call per item per poll. They are still checked for
closing (6.2) as before. Review requests (`github-pr`) have no issue fields and keep the labels.

**D46. donePM works only in repositories the user manages; managing replaces ignoring.** With
#33 every assigned issue of every repo came onto the board until the user ignored its repo, and a
fresh install filled the board with work from repositories the user never meant donePM to touch
(#94). Opt-in fits "the user approves every outward action" better than opt-out. `sources` gets
`managed` (default false); `ignored` is read once for the migration and then dropped. Migration:
when no entry has a `managed` key yet and items exist, every origin with items or a source entry
becomes managed unless it was ignored, so an upgrade keeps the board as it was. Unmanaging writes an
explicit `managed: false`, so the migration never runs twice, even when nothing is managed. The
global searches (assigned issues, review requests) stay one call each: dropping them would hide
what the user could manage, and a per-repo search costs a call per repo per poll. Their results
from unmanaged repos are dropped; those without a local clone are counted into a "found on GitHub"
list in Settings with "Clone and manage", since a clone is the user's statement that they want to
work there. Unmanaged repos with a local clone are in the repos list with their checkbox. Items of
an unmanaged repo leave the board but are not deleted or closed, so managing the repo again brings
them back as they were; items that are running, `needs_you`, or hold an open ask or draft stay
visible, because hiding them would hide work waiting on the user. Start refuses an item of an
unmanaged repo (409); a resume of an already started item is not blocked.

**D47. Pull requests assigned to the user are reviewed, not taken over; Dependabot's included.**
Issue #98 planned a Dependabot-only source (`gh pr list --author app/dependabot` per repo) and a
playbook that fixes, pushes to and merges the update. The user's intent is broader and stricter: a
pull request assigned to them, by Dependabot or by a colleague, is work like an issue, and the work
is a review. Changes the user wants are review comments for whoever opened it; donePM never pushes
to someone else's branch, so the four-eyes principle holds and the author stays the author. Hence:
the poll adds `gh search prs --assignee=@me` (one call, like the review request search, D40),
merged with it by `externalId`; Dependabot PRs come in when Dependabot assigns the user
(`assignees` in `dependabot.yml`), with no per-repo call and no `schedules` table, since Dependabot
already runs on its own schedule. Items keep the PR's `author`, and the card says `PR · dependabot`.
The playbook stays `review` (D43): comments go out only as drafts the user approves. A merge
conflict is reported on the card and answered with a comment draft (for Dependabot `@dependabot
rebase`), not resolved by the agent. Once the user's own review approved the PR, its checks pass
and it is mergeable, the card offers Merge; the click is the user's approval, like Clone (#37). A
per-item "merge automatically" checkbox, defaulting to a per-repo setting that is off, lets the
daemon merge as soon as those three hold; turning it on is the approval given in advance (D2).

## Open (not decided)

- Whether the playbook should tell the agent to commit. D25 covers what it leaves behind.
- Jira Cloud vs Server auth details. Decide when the Jira adapter starts.
- Team/server component. Not before a second user asks.
