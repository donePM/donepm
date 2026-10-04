# Spec: donePM MVP

See `intent.md` for the why. This file says what to build. MVP only.

## 1. Scope

In scope:

- Sources: GitHub issues assigned to the current user, and open pull requests that request the
  user's review (D40), via `gh`.
- Repositories: found by scanning one root folder.
- Board with four columns: Ready, In Progress, Needs You, Done.
- One agent type: Claude Code, run as a child process, in a git worktree.
- Two playbooks: `implement`, and `review` for pull requests under review (D42). Playbooks are
  Markdown files.
- One draft type: `pr`. The user approves it. The daemon pushes and creates the PR. Follow-ups on
  that PR: `push` (6.6, 6.7) and `comment` (replies to review feedback, 6.9). A `review` draft is
  the review of someone else's pull request (D43).
- Agent permission questions shown as cards.
- Live agent transcript in the UI.
- Settings: repo root, worktree root, port, CLI status.
- Event log per work item, shown as a timeline on the card.
- CLI: `donepm start|stop|status`.

Out of scope for the MVP: Jira, GitLab, schedules, Dependabot,
log analysis, token login (only `gh` auth), multiple agents per item, agent budget, AI playbook
selection, server sync.

## 2. Stack

- Node 22+, TypeScript, pnpm workspaces.
- Daemon: Fastify (HTTP + static files), `ws` (push to UI).
- Database: SQLite via `node:sqlite` (fallback `better-sqlite3` if needed).
- Agent: `claude` CLI, stream-json over stdin/stdout. Protocol as documented in Bloom
  `docs/PROTOCOL.md`.
- UI: Vue 3, Vite, built into the daemon at build time.
- Process: one long-running daemon. Started by launchd (`KeepAlive`). Logs in
  `~/Library/Logs/donepm/`.
- Default port: **6174**. Configurable.

## 3. Packages

```
packages/
  core/     domain: items, events, drafts, playbooks, state machine. No I/O. Fully tested.
  daemon/   HTTP, WebSocket, SQLite, git, gh adapter, agent runner, MCP server, scheduler (later)
  web/      Vue UI
  cli/      thin CLI, talks to daemon over HTTP
```

Rule: `core` imports nothing from `daemon` or `web`. All state transitions live in `core` as pure
functions. `daemon` calls them and persists the result.

## 4. Domain model

### 4.1 WorkItem

| field | type | notes |
|---|---|---|
| id | uuid | |
| source | `github-issue` \| `github-pr` | `github-pr`: a pull request that requests the user's review (D40) |
| externalId | string | `owner/repo#123` |
| externalUrl | string | |
| repoId | uuid | |
| title | string | |
| body | string | raw issue body |
| labels | string[] | |
| state | enum | see 4.2 |
| playbook | string | playbook name, default `implement`; `review` for `github-pr` |
| priority | int | tier from the labels, 0 most urgent (see 12.1); recomputed on every poll |
| issueCreatedAt | datetime? | when the issue was opened upstream (6.2) |
| startedAt | datetime? | first `start`; kept on retry and through Needs You |
| stateSince | datetime | when the item entered its current state; transitions that keep the state leave it |
| worktreePath | string? | set when agent starts |
| branch | string? | |
| baseBranch | string? | a review's PR base, set when its worktree is created (D41); else the repo's default branch is the base |
| agentSessionId | string? | Claude `session_id`, for `--resume` |
| archivedAt | datetime? | set once by `archived` (6.8); an archived item is off the board and in the Archive (12.5) |
| createdAt, updatedAt | datetime | |

### 4.2 Item states

```
ready → running → needs_you → running → ... → checking → done
                ↘ failed                         ↘ needs_you (CI red) → running (fix) → …
checking | done → needs_you (PR conflicts, 6.7) → running (resolve) → … | back where it was
done → needs_you (review feedback, 6.9) → running (address) → … | done
```

| state | column | meaning |
|---|---|---|
| ready | Ready | collected, no agent yet |
| running | In Progress | agent turn is open |
| needs_you | Needs You | agent waits: permission question, or a draft is pending; or the PR's CI is red, it conflicts with its base, or reviewers left feedback |
| checking | In Progress | the PR is open and the daemon waits for its CI (6.6); no agent runs |
| done | Done | CI of the PR passed, the PR has no CI, or the user marked it done |
| failed | Needs You | agent exited with error; card shows stderr tail and offers retry |

Transitions are functions in `core`: `start(item)`, `agentAsked(item)`, `answered(item)`,
`draftCreated(item)`, `draftApproved(item)`, `draftExecuted(item)`, `draftExecutionFailed(item)`,
`draftRejected(item)`, `agentFailed(item)`, `interrupted(item)`, `resume(item)`,
`worktreeRemoved(item)`, `ciPassed(item)`, `ciFailed(item)`, `ciRerun(item)`, `ciMarkedDone(item)`,
`ciFix(item)`, `prConflicted(item)`, `prConflictResolved(item)`, `prConflictDismissed(item)`,
`prConflictFix(item)`, `prFeedback(item)`, `prFeedbackFix(item)`, `prFeedbackDismissed(item)`,
`repliesPosted(item)`, `reviewPosted(item)` (needs_you → done, D43), `archived(item, finishedAt)` (only from `done`, once; sets `archivedAt`, 6.8).
Invalid transitions throw.

### 4.3 Event

Append-only. Never updated. Deleted only together with their whole item, by the retention purge
(6.8); a trigger refuses any other delete. The purge itself is logged, not recorded as an event:
nothing would be left to attach it to.

| field | type |
|---|---|
| id | uuid |
| itemId | uuid |
| at | datetime |
| actor | `user` \| `agent` \| `system` |
| type | string, see below |
| payload | JSON |
| refId | uuid? (draft id, ask id, message id) |

Event types in MVP: `item.collected`, `item.playbook_changed`, `agent.started`, `agent.resumed`,
`agent.turn_started`, `agent.turn_ended` (payload: `subtype`, `isError`, `costUsd` from `total_cost_usd`, and `usage` from `result.usage` as `inputTokens` = input + cache read + cache creation, `outputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`; `reasoningTokens` is never reported; a missing `usage` is left out), `agent.failed`, `permission.asked`, `permission.answered`, `draft.created`,
`draft.edited`, `draft.approved`, `draft.rejected`, `draft.executed`, `draft.execution_failed`,
`agent.interrupted`, `worktree.removed`, `item.assigned`, `item.assign_failed` (assign on start,
see 6.4), `permission.auto_allowed` (the daemon answered an ask itself: a WebFetch host on the
list or an "Always allow" grant, see 9.4), `permission.granted` and `permission.grant_revoked`
(an "Always allow" grant was added or removed, see 9.4),
`item.closed_upstream` (a never-started item moved to Done) and `item.dismissed` (the user moved
a started one to Done), both see 6.2, `item.pr_merged` (the item's PR was merged, the worktree
stays) and `worktree.remove_skipped` (merged, but the worktree has uncommitted changes), both see
6.5, `ci.started`, `ci.passed`, `ci.failed` and `ci.marked_done` (see 6.6), `pr.conflicted`,
`pr.conflict_resolved` and `pr.conflict_dismissed` (see 6.7), `pr.feedback` and
`pr.feedback_dismissed` (see 6.9), `item.archived` (actor `system`,
payload `{ finishedAt }`, see 6.8). `agent.resumed` carries
`reason: "ci_failed"` when the user let the agent fix a red CI, `reason: "pr_conflict"` when it
resolves a merge conflict, `reason: "pr_feedback"` when it addresses review feedback. `worktree.removed` carries `reason: "pr_merged"` and actor `system` when the poll removed it.

### 4.4 Draft

| field | type | notes |
|---|---|---|
| id | uuid | |
| itemId | uuid | |
| type | `pr` \| `push` \| `comment` \| `review` | |
| payload | JSON | for `pr`: `{ title, body, base }`; for `push`: `{ summary, number, url, branch, commits, uncommitted, replies? }`; for `comment`: `{ number, url, replies }`. A reply is `{ body, inReplyTo? }` (6.9); for `review`: `{ number, url, commitId, verdict, body, comments }`, a comment `{ path, line, body }` (D43) |
| state | `pending` \| `approved` \| `rejected` \| `executed` \| `failed` | |
| userEdits | JSON? | the payload after user edits |
| result | JSON? | for `pr`: `{ url, number }`; for `push`: `{ sha, posted? }`; for `comment`: `{ posted }`; for `review`: `{ id, url }`. `posted` lists `{ index, url }` per reply out, written after each one so a retry skips them |

### 4.5 PermissionAsk

| field | type |
|---|---|
| id | uuid |
| itemId | uuid |
| requestId | string (from CLI) |
| toolName | string |
| input | JSON |
| state | `pending` \| `allowed` \| `denied` \| `expired` (pending when the daemon restarted) |

### 4.5a PermissionGrant ("Always allow", D38)

| field | type | notes |
|---|---|---|
| id | uuid | |
| repo | string | normalised origin, `github.com/owner/repo`; every clone shares it |
| toolName, ruleContent | string, string? | the rule as Claude Code suggested it |
| createdAt | ISO time | |
| askId, itemId | uuid | the ask it was granted on; no foreign key, a grant outlives the purge (6.8) |
| call | string | that ask's call in words, e.g. `Bash: pnpm test` |
| useCount, lastUsedAt | int, ISO time? | asks it answered |
| revokedAt | ISO time? | set by Remove; the row stays, it no longer matches |

### 4.6 Repo

| field | type | notes |
|---|---|---|
| id | uuid | |
| path | string | local clone |
| originUrl | string | normalised: `github.com/owner/repo` |
| defaultBranch | string | from `git symbolic-ref refs/remotes/origin/HEAD` |
| setup | JSON? | from `.donepm/setup.yml`, see 7.3 |

What donePM collects for a repo is the user's business, not the repo's: it lives in the user
config under `sources`, keyed by `originUrl`, not in `.donepm/` (see 14). Per repo:

| field | type | notes |
|---|---|---|
| query | string? | the provider's issue search, pasted from its UI. Absent: issues assigned to me |
| assignOnStart | boolean | default `false`; see 6.4 |

The provider follows from the host. Only `github.com` is supported; GitLab (issue list params via
`glab api`) and Jira (JQL) can be added without changing the format. Other hosts are rejected.

### 4.7 Transcript message

| field | type |
|---|---|
| id | uuid |
| itemId | uuid |
| sessionId | string |
| at | datetime |
| kind | `user` \| `assistant_text` \| `assistant_thinking` \| `tool_use` \| `tool_result` \| `result` \| `raw` |
| raw | JSON (the full stream-json line) |

Keep the raw line always. Decode what is known. Never fail on unknown event types.

## 5. Repo discovery

- Config: `repoRoot` (one folder).
- Scan recursively for `.git` directories. Max depth 4. Skip `node_modules`, `vendor`, `.git`
  contents, hidden folders.
- For each repo: read `origin` URL, normalise (strip `https://`, `git@`, `.git`, trailing
  slash). Store in `repos`.
- Rescan on daemon start and on button click in Settings. Cache in SQLite.
- Match issues to repos by normalised origin URL. Issues without a local repo are shown in Ready
  with a "no local clone" badge and cannot be started.

## 6. GitHub adapter

### 6.1 Detection

On start and on Settings open:

- `which gh` → found or not.
- `gh auth status` → logged in or not.
- Show state in Settings: `not installed` / `not logged in` / `ready`. Show `brew install gh`
  and `gh auth login` as copyable hints. Button: "Check again".

### 6.2 Polling

- Every 60 seconds (configurable).
- Command:
  ```
  gh search issues --assignee=@me --state=open --json number,title,body,createdAt,labels,repository,url
  ```
  If `gh search` is not available, fall back to `gh issue list --assignee @me --json ...` per
  known repo.
- Review requests (D40), same poll, same fields and schema:
  ```
  gh search prs --review-requested=@me --state=open --json number,title,body,createdAt,labels,repository,url
  ```
  Each becomes a `github-pr` item with playbook `review`. Without `gh search prs` there are no
  review requests, not an error. A closed or merged PR is found like a closed issue: `gh issue view
  --json state` answers `MERGED` for a merged PR, which counts as closed.
- Validate output with a schema (zod). On schema failure: log the raw output, do not crash, show
  an error badge in Settings.
- Upsert items by `externalId`. New issue → `item.collected` event, state `ready`. Closed issue
  that is not `done` (D32):
  - never started (`ready`, no worktree, no agent session) → the daemon moves it to `done` with an
    `item.closed_upstream` event (actor `system`). Nothing can be lost.
  - started (any other state, or `ready` with a worktree or session) → keep item, add badge
    "closed upstream". The card offers **Dismiss**, which moves it to `done` with `item.dismissed`
    (actor `user`). Not while the agent runs: the user stops it first. The worktree stays until
    the user removes it.
  An issue seen open again clears the badge; an item already in `done` stays there.
- Never delete items here. Only the retention purge deletes, and only archived items (6.8).
- Archived and purged items (D37). An archived item's issue still open in the poll is skipped; one
  missing from it is checked like any other and flagged closed upstream. An issue whose archived
  item was flagged closed shows up again → reopened: collected as a **new** item, the archived one
  stays as it is. A purged item leaves a tombstone (`externalId`, `source`, `originUrl`, `closed`,
  `deletedAt`). While the tombstone is open the issue is skipped; the poll confirms each open
  tombstone missing from the results with `gh issue view` and marks it closed. A closed tombstone
  whose issue shows up again is removed and the issue is collected fresh. External ids are unique
  among live items only.
- Repos with a `query` (4.6) are polled in addition, one call each:
  ```
  gh issue list --repo <origin> --search "<query>" --state open --json number,title,body,createdAt,labels,url
  ```
  `--repo` pins the repository, so a pasted query cannot reach into others, and pull requests are
  excluded. GitHub's search syntax including `OR` and parentheses passes through unchanged.
  (`gh search issues "<query>"` quotes the whole string as one term and does not work.) The
  repository name is taken from each issue URL, so an issue found by both the default search and a
  query keeps GitHub's spelling and stays one item.
- A failing source does not stop the others; its error shows on its repo in Settings. Items are
  only checked for "closed upstream" when every source answered.

### 6.3 Execution (after draft approval)

Run by the daemon, never by the agent:

```
git -C <worktree> push -u origin <branch>
gh pr create --repo <owner/repo> --head <branch> --base <base> --title <t> --body-file <tmp>
```

Store the PR URL in the draft result. Add `draft.executed` and `ci.started`. Set item to `checking`.

A `push` draft runs only the push (uncommitted changes are committed first, as for `pr`) and stores
the new head as `{ sha }`; then `ci.started` again and `checking`. With `replies`, they are posted
after the push (6.9).

A `comment` draft only posts its replies (6.9): `draft.executed` with `{ posted }`, item `done`, no
CI wait since nothing was pushed. A reply that fails stops the draft with step `reply`; approving
again posts only the ones not out yet.

A `review` draft (D43) posts one review with all its inline comments, pinned to the reviewed commit:

```
gh api --hostname <host> --method POST repos/<o>/<r>/pulls/<n>/reviews --input <tmp>
```

`<tmp>` (0600) holds `{ commit_id, event, body, comments: [{ path, line, side: "RIGHT", body }] }`.
Result `{ id, url }`, `draft.executed`, item `done`. A failure stops the draft with step `review`.

### 6.4 Assign on start

When the item's repo has `assignOnStart`, `start` also runs
`gh issue edit <n> --repo <owner/repo> --add-assignee @me` in the background and records
`item.assigned` or `item.assign_failed` (with the reason). Neither changes the state; a failure does
not stop the agent. The daemon runs this, never the agent (decision D28). Only for `github-issue`
items: a PR under review is someone else's.

### 6.5 PR state

Part of each poll, after the CI watch, and only while `gh` is ready (D33, D36). For every item with
an executed PR draft that is `done` with no recorded merge (with or without a worktree: the merge
decides when the item is finished, 6.8), `checking`, or has a recorded conflict that has not ended (6.7):

```
gh pr view <number> --repo <host/owner/repo> --json state,mergedAt,mergeable,baseRefName
```

`--repo` comes from the PR URL in the draft result. `mergeable` feeds 6.7; `state: OPEN` on a `done`
item feeds 6.9; for the worktree only `MERGED` matters. A failure is logged and retried on the next poll.

- `removeWorktreeOnMerge` off → `item.pr_merged`, once.
- On, worktree clean → removed as in 7.4, branch kept, `worktree.removed` (actor `system`, reason
  `pr_merged`). Clean means `git status --porcelain --untracked-files=all` lists nothing besides the
  files `.donepm/setup.yml` copies (7.3).
- On, worktree dirty → `item.pr_merged` and `worktree.remove_skipped` with the reason and the files,
  once. Checked again each poll; removed once it is clean.
- The agent runs → `item.pr_merged`; the worktree is left alone.
- No worktree (the user removed it) → `item.pr_merged`.

Turning the setting on later removes worktrees of PRs already recorded as merged on the next poll.

### 6.6 CI watch

Part of each poll, before 6.5, while `gh` is ready (decision D35). For every `checking` item:

```
gh pr checks <number> --repo <host/owner/repo> --json name,state,bucket,link,workflow,startedAt,completedAt
```

The JSON on stdout counts whatever the exit code (gh exits 8 while checks pend, 1 when one failed).
"no checks reported" on stderr means no checks. All checks count, required or not. `bucket`
`pass`/`skipping` is green, `fail`/`cancel` is red, anything else pending; the verdict waits until
every check finished.

- No checks within 60 s of `ci.started` → pending (checks register late); after that → passed with
  `checks: 0` ("no CI").
- A failure that completed before `ci.started` is stale within the 60 s (a rerun not restarted yet).
- Green → `ci.passed { number, url, checks }`, item `done`.
- Red → the daemon fetches the end of each failed job's log (`gh run view <run> --repo <r>
  --log-failed`, last 40 lines per job, timestamps and ANSI stripped) and records `ci.failed { number,
  url, failed, logs }`; item `needs_you`. The card offers:
  - **Fix with agent**: resumes the session with the failures and logs as message (`agent.resumed`,
    reason `ci_failed`). The agent fixes, commits and calls `draft_push`.
  - **Rerun failed**: `gh run rerun <run> --failed --repo <r>` per failed run; `ci.started` with
    `reason: "rerun"`; item `checking`.
  - **Mark done**: `ci.marked_done`, item `done`. Also offered while `checking`.

A failed `gh` call is logged and retried on the next poll; the item stays `checking`.

### 6.7 Merge conflicts

From the same `gh pr view` as 6.5 (decision D36). Only `mergeable: CONFLICTING` counts; `UNKNOWN`
(GitHub has not computed it yet, e.g. right after a push to the base) changes nothing.

- `CONFLICTING`, item `done` or `checking`, no conflict recorded → the daemon fetches the base
  (`git fetch origin <base>` in the main clone) and asks `git merge-tree --write-tree --name-only
  <origin/base> <branch>` for the conflicting files (exit 1 = conflicts; none when it cannot tell).
  `pr.conflicted { number, url, base, files, from }`, item `needs_you`. Once per conflict.
- `MERGEABLE`, `MERGED` or `CLOSED` with a conflict recorded → `pr.conflict_resolved`. An item still
  waiting on it goes back to `from`; anywhere else it stays.

The card offers:

- **Resolve with agent** (needs a session): the daemon fetches the base (the agent has no network),
  then resumes the session (`agent.resumed`, reason `pr_conflict`) with the base and the files as
  message. The agent merges `origin/<base>` (no rebase, so the push does not rewrite the PR), runs
  the tests, commits, and calls `draft_push`. After the push the item waits for CI (6.6).
- **I'll do it myself**: `pr.conflict_dismissed` (actor `user`), item back to `from`. The card shows
  a quiet note "PR #n has merge conflicts with main" until the conflict ends.

### 6.8 Retention

Part of each poll, after the CI watch and the PR state, also while `gh` is not ready (D37). The
clock is the daemon's `Ctx`, so tests move it.

- **Finished**: `done`, and the PR merged if a draft opened one (`item.pr_merged`, or
  `worktree.removed` with reason `pr_merged`). A done item without a PR (closed upstream,
  dismissed, marked done) is finished when it became done. `finishedAt` is the later of the
  merge and `stateSince`. A PR closed without merge never finishes the item.
- **Archive**: a finished item with no pending draft or ask, finished for `archiveAfterHours`
  (14), gets `archived` (4.2): `item.archived`, `archivedAt`. It leaves the board (`item.removed`
  over the WebSocket) and stays in the Archive (12.5) with its events, drafts and transcript.
- **Purge**: an archived item archived for `deleteAfterDays` and without a worktree is deleted in
  one transaction with its events, drafts, asks and transcript, and a tombstone is written (6.2).
  The daemon log records it. `deleteAfterDays: null` never deletes. An item that still has a
  worktree is kept until the user (or the merge, 6.5) removes it.
- A failure on one item is logged; the others go on. Changed settings apply on the next poll.

### 6.9 Review feedback

From the same poll as 6.5 (decision D39): for an item that is `done` whose PR is `OPEN`, the daemon
reads the PR's reviews and comments with one GraphQL call:

```
gh api graphql --hostname <host> -F owner=<o> -F name=<r> -F number=<n> -f query=<FEEDBACK_QUERY>
```

Feedback is, from people other than the PR's author (the user, so donePM's own replies never count)
and never from bots (`__typename: Bot`):

- a review in state `CHANGES_REQUESTED`, or `COMMENTED` with a body (approvals, dismissed and
  pending reviews are not feedback);
- every inline comment of such a review, with its path, line, diff hunk and thread (the id of the
  thread's first comment);
- a comment in the PR's conversation.

Entries are known by `kind:id`. New feedback is what no earlier `pr.feedback` recorded; while the
item is `running`, `checking` or `needs_you` it waits until the item is `done` again. New feedback →
`pr.feedback { number, url, entries }`, item `needs_you`. A failed call is logged and retried next
poll. Red CI after done is not feedback; the CI watch only runs while `checking`.

The card offers:

- **Address with agent** (needs a worktree and a session): resumes the session (`agent.resumed`,
  reason `pr_feedback`) with every entry, inline ones with `path:line`, thread number and the end
  of their diff hunk. The agent changes what is needed, commits, and calls `draft_push` with
  `replies`; or, when nothing needs to change, `draft_comment`.
- **Mark done**: `pr.feedback_dismissed` (actor `user`), item `done`. Those entries do not come back.

A reply with `inReplyTo` answers in that inline thread; without it, it is a comment on the PR. The
daemon posts it as the user after approval, never the agent:

```
gh pr comment <n> --repo <host/o/r> --body-file <tmp>
gh api --hostname <host> --method POST repos/<o>/<r>/pulls/<n>/comments/<thread>/replies -F body=@<tmp> --jq .html_url
```

`inReplyTo` must be a thread from a `pr.feedback` of this item; anything else is refused when the
draft is created, so a reply cannot land on an unrelated thread.

## 7. Worktrees

### 7.1 Location

`worktreeRoot`, default `~/.local/share/donepm/worktrees/`. Path per item:
`<worktreeRoot>/<repo-slug>/<branch-slug>/`.

### 7.2 Create

```
git -C <repo> fetch origin <defaultBranch>
git -C <repo> worktree add -b <branch> -- <path> origin/<defaultBranch>
```

Branch name: `<prefix><issue-number>-<slug-of-title>`, prefix configurable, default `dp/`.
Max 60 chars. If the branch exists: append `-2`, `-3`.

A `github-pr` item (D41) is checked out at the PR's head instead. `gh pr view --json
state,mergedAt,mergeable,baseRefName` gives the base (stored as `baseBranch`); a PR that is not
open is refused. Then:

```
git -C <repo> fetch origin <base> +refs/pull/<n>/head:refs/donepm/pull/<n>
git -C <repo> worktree add -b <prefix>review-<n>-<slug> -- <path> refs/donepm/pull/<n>
```

No setup (7.3) runs for it: no dependency install, no `setup.yml`.

### 7.3 Setup per repo

Setup runs in a new worktree before the agent starts: dependencies first, then the setup file.

Dependencies (D34). Package managers are detected from the lockfiles in the worktree root:
`pnpm-lock.yaml`, `bun.lock`/`bun.lockb`, `yarn.lock`, `package-lock.json` (the first one found,
since they share `node_modules`) and `composer.lock`. The directories are every `node_modules` of a
directory with a tracked `package.json`, or `vendor`, if gitignored and not yet in the worktree.
When the main clone's lockfile is byte-identical and the main clone has the root directory, they
are cloned copy-on-write (`cp -c -R` on macOS, `cp -R --reflink=auto` on Linux). Otherwise the
daemon runs, in the worktree: `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`,
`yarn install --immutable` (with `.yarnrc.yml`) or `--frozen-lockfile`, `npm ci`,
`composer install --no-interaction`. Each step is a `system` transcript message
`{ type: "donepm_setup", step: "dependencies", manager, method: "clone" | "install", … }`.

Optional file in the repo: `.donepm/setup.yml`

```yaml
dependencies: auto   # or off; default auto
copy:
  - .env
  - storage/oauth-private.key
run:
  - composer install
  - npm ci
```

`copy` copies files from the main clone into the worktree. `run` executes commands in the
worktree, in order, with output stored in the item's transcript as `system` messages. Setup
failure → item `failed`, card shows output.

### 7.4 Remove

Button on a `done` or `failed` card: "Remove worktree". Runs
`git worktree remove --force <path>` and `git worktree prune`. Branch is kept. Automatic only after
the PR is merged, with `removeWorktreeOnMerge` on and a clean worktree (6.5, D33).

### 7.5 Reconcile on start

On daemon start: for each repo, `git worktree list --porcelain`. Compare with items. Worktrees
not in the database → show in Settings as "orphaned" with a remove button. Items whose worktree
is missing → mark `failed` with reason.

## 8. Playbooks

### 8.1 Files

- Global: `~/.config/donepm/playbooks/*.md`
- Per repo: `<repo>/.donepm/playbooks/*.md`. Same name overrides global.
- Ship two built-in defaults, `implement.md` and `review.md`, each written to the global folder on
  start if a file of that name is missing.

### 8.2 Format

```markdown
---
name: implement
model: opus
effort: high
permission_mode: acceptEdits
drafts: [pr]
match:
  source: github-issue
---
You are working on a GitHub issue in a dedicated git worktree.

Issue {{ externalId }}: {{ title }}

{{ body }}

Read CLAUDE.md first if it exists. Implement the change. Run the tests.
When done, call the `draft_pr` tool with a title and a body. Do not run `gh`, `git push`
or any other command that leaves this machine. The user will review and publish your draft.
```

Frontmatter fields:

| field | required | values |
|---|---|---|
| name | yes | unique |
| model | yes | passed to `--model` |
| effort | no | passed to `--effort` |
| permission_mode | yes | `default` \| `acceptEdits` \| `plan` \| `bypassPermissions` |
| read_only | no | `true`: no edit or web tools, project settings not loaded (9.1, D42); needs `permission_mode: default` and no `pr` draft |
| drafts | yes | list of allowed draft types: `[pr]`, `[review]`; `pr` also allows `draft_push` and `draft_comment` |
| match.source | no | source filter |
| match.labels | no | any of these labels |

Body: the first user message. Placeholders: `{{ externalId }}`, `{{ title }}`, `{{ body }}`,
`{{ labels }}`, `{{ branch }}`, `{{ repoPath }}`, `{{ base }}` (the PR's base for a review, else the
default branch).

### 8.3 Selection (MVP)

- Candidates: playbooks whose `match` fits the item. No `match` = fits everything.
- Exactly one candidate → use it.
- More than one → use the first by name, show dropdown on the card. Later: classifier interface
  `choosePlaybook(item, candidates)` with providers (rules, jev.ai, Claude). Not in MVP.
- User changes via dropdown → `item.playbook_changed` event.

## 9. Agent runner

### 9.1 Start

Working directory: the worktree.

```
claude -p
  --output-format stream-json
  --input-format stream-json
  --include-partial-messages
  --verbose
  --permission-mode <playbook.permission_mode>
  --permission-prompt-tool stdio
  --model <playbook.model>
  [--effort <playbook.effort>]
  --mcp-config <path to per-session json file>
  [--resume <agentSessionId>]
```

Notes:

- `--permission-prompt-tool stdio` is undocumented but required. Without it the CLI denies
  silently. Verify it still works with the installed CLI version on start (`claude --version`
  logged).
- `--mcp-config` is a file (mode 0600), never inline JSON, because argv is visible in `ps`.
- Do not pass `--strict-mcp-config`. The user's own MCP servers must keep working.
- Environment: copy the user's env, but remove `gh`, `glab`, `jira` from reach by setting
  `PATH` to a filtered copy without the directories that contain them. Also add deny rules via
  `--settings` for `Bash(gh *)`, `Bash(git push*)`. Both together.
- The same `--settings` enables the Bash sandbox (D27): `enabled`, `autoAllowBashIfSandboxed`,
  `allowUnsandboxedCommands: false`, and `filesystem.allowWrite` for the user's cache directories.
  A network connection from Bash arrives as a `can_use_tool` ask with `tool_name`
  `SandboxNetworkAccess` and input `{ host }`; the UI shows it as "Network access".
  `GH_CONFIG_DIR` and `GLAB_CONFIG_DIR` point at an empty directory under the data dir.
- The same `--settings` allows `mcp__donepm`: its tools only create drafts, so a permission
  question per call would ask the user twice for the same thing.
- A `read_only` playbook (D42) adds deny rules for `Edit`, `Write`, `MultiEdit`, `NotebookEdit`,
  `WebFetch`, `WebSearch`, allows `Bash(git diff *)`, `Bash(git log *)`, `Bash(git show *)`, sets
  `autoAllowBashIfSandboxed: false`, and passes `--setting-sources user` so the worktree's
  `.claude/settings*.json` (hooks, permissions, MCP enablement) is not loaded. Still no
  `--strict-mcp-config`. "Always allow" grants (D38) do not answer its asks.

### 9.2 First message

One NDJSON line on stdin:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<rendered playbook body>"}]}}
```

stdin stays open for the whole session.

### 9.3 Reading stdout

Parse line by line. Handle:

| event | action |
|---|---|
| `system` / `init` | store `session_id` on the item immediately. `agent.started` or `agent.resumed` event |
| `assistant` | store transcript message; push to UI |
| `user` (tool_result) | store transcript message; push to UI |
| `stream_event` | push to UI for live text; do not store |
| `control_request` / `can_use_tool` | create PermissionAsk, item → `needs_you`, push to UI |
| `result` | `agent.turn_ended` event; if no draft pending and no ask pending, item stays `running` and waits? No: item → `needs_you` with badge "agent finished without draft" |
| unknown | store as `raw` |

A second `init` during a session means the CLI started a turn on its own (background task
notification). Treat as turn start. Do not fail.

Subagents (Claude Code's own, D10) arrive in the same stream. A tool call named `Agent` (`Task`
in older CLIs) starts one. Every message the subagent produces is an ordinary `assistant` or
`user` line with `parent_tool_use_id` set to that call's id; its asks are ordinary
`can_use_tool` requests with `request.agent_id` set to the task id. Its lifecycle comes as
`system` lines, stored as `raw`: `task_started` (task id, call id, type, background),
`task_progress` (current activity, tool count, duration), `task_updated` (status, task id only)
and `task_notification` (end status and summary; also sent for background Bash tasks, which have
no `Agent` call). The `Agent` tool result carries the report and, in `tool_use_result`, the
totals. `tool_progress` heartbeats are stored and not shown. The daemon treats all of these like
any other line; grouping is the transcript view's job (`core/transcript/subagent.ts`, recorded in
`fixtures/stream/subagent.jsonl`).

### 9.4 Permission answer

```json
{"type":"control_response","response":{"request_id":"<id>","subtype":"success","response":{"behavior":"allow","updatedInput":<input>}}}
```

or `"behavior":"deny","message":"<text>"`. `request_id` must match. After answering: item back
to `running`.

"Deny and stop". A deny normally lets the agent try another way to the same goal. The ask panel
offers "Deny and say why…": a text field ("The agent reads this.") with **Deny** and **Deny and
stop**. The latter answers

```json
{"behavior":"deny","message":"<text>","interrupt":true}
```

so Claude Code ends the turn right away (Bloom's `interrupt: true`; not measured against the
installed CLI yet, no fixture). The HTTP answer takes `interrupt?: boolean` on a deny; the message
stays optional and defaults to "The user denied this.". The `permission.answered` payload is
`{ behavior, rules, interrupt }`, `interrupt` false unless the user stopped the turn. The turn ends
like any other: `result` gives `agent.turn_ended` and the item goes to `needs_you`, so the user
can write the next message. A decline of an `AskUserQuestion` has no stop button.

"Allow for this run" (D30). The request's `permission_suggestions` holds `addRules` entries, for
example `{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"curl *"}],"behavior":"allow","destination":"localSettings"}`.
The daemon keeps the allow rules for the asked tool only (Claude Code may attach others, e.g. a
`Read(/tmp/**)` rule to a Bash ask; a `SandboxNetworkAccess` ask keeps its `WebFetch(domain:…)`
rule), drops any that would cover a blocked command or all of Bash, and offers a second button when
any are left. A request with `suppress_always_allow_rule` or `requires_user_interaction` set to
`true` (undocumented; Bloom hides the wider buttons for them) offers no rules at all, so the panel
shows only Allow and Deny; missing or any other value means false. `AskUserQuestion` asks carry
`requires_user_interaction: true` (recorded in `ask-question.jsonl`). The selection is
`sessionRules` in core. Under the buttons the panel says in plain words what the second button
grants before it is pressed: "Bash commands matching `bin/test *`" (the legacy `cmd:*` shown as
`cmd *`), "web and network access to `github.com`", "`<Tool>` calls matching `<pattern>`", or "all
`<Tool>` calls", followed by "for the rest of this run". Answering with it adds them for the
session:

```json
{"behavior":"allow","updatedInput":<input>,"updatedPermissions":[{"type":"addRules","rules":[…],"behavior":"allow","destination":"session"}]}
```

`destination` is always `session`, whatever the suggestion said. The `permission.answered` event
payload is `{ behavior, rules }`, with `rules` empty for a one-time answer.

"Always allow in <owner/repo>" (D38). A third button, shown whenever "Allow for this run" is, stores
the same rules as grants of the item's repository (`permission_grants`, 4.5a) and answers this ask
with a **plain** allow, no `updatedPermissions`. The hint under the buttons adds "; "Always allow"
in every run in <owner/repo>, until you remove it in Settings". The `permission.answered` payload is
`{ behavior: "allow", rules: [], interrupt: false, always: [{ grantId, repo, toolName, ruleContent? }] }`,
and each new grant gets a `permission.granted` event (actor `user`, refId the grant, payload the
grant plus `askId`). A rule the repo already has is not stored twice. The daemon refuses the scope
for an ask without rules or with a blocked one (409).

On every new ask the daemon reads the repo's active grants and answers by itself when
`matchGrants` (core) says so: Claude Code suggested at least one allow rule for the asked tool, none
of them is blocked, each equals an active grant exactly (tool name and rule content, as suggested),
neither flag is set, and the tool is not `AskUserQuestion`. A stored grant on the block list never
matches. The answer is a plain allow; the item stays `running`; the ask is stored as `allowed` with
the outcome reason "always allowed in <owner/repo>: `Bash(pnpm test *)`"; the grants' `useCount`
and `lastUsedAt` go up; a `permission.auto_allowed` event (actor `system`, payload `{ toolName,
repo, grants: [{ grantId, toolName, ruleContent? }] }`) records it. Because the CLI never got a
session rule, it asks again next time, so removing a grant applies at once, also in a run already
going: the next matching ask goes to the user. Remove records `permission.grant_revoked` on the item
the grant was made on, if that item still exists.

Showing an ask. The ask panel shows the tool's whole input, never cut: Bash the full command (plus
`description`, plus `cwd` when it is not the worktree), Write/Edit/MultiEdit the path and the
diff, WebFetch the URL, the sandbox's network ask the host, anything else the input as JSON. The
request's `decision_reason` is stored with the ask and shown above it, ANSI codes stripped. The same
panel answers the ask on the board, on the item page and in the Agents view, where it sits in the
transcript's ask row (inside the subagent's row for a subagent's ask). An answered ask's row shows
how it ended: allowed, allowed for this run (the answer carried `updatedPermissions`), denied, or
expired. The one-line summary stays in the timeline, with the whole input as its tooltip.

What asks and what does not (measured with `claude 2.1.288`):

- A network ask (`SandboxNetworkAccess`) suggests `WebFetch(domain:<host>)`. Claude Code uses that
  one rule for WebFetch and for the sandbox's network, so the UI says "web and network access to
  <host>". After a plain allow, the CLI does not ask again for that host in the same session.
- A sandboxed Bash command normally runs without an ask (`autoAllowBashIfSandboxed`). One that
  Claude Code cannot check statically still asks, with `decision_reason` "A variable in this
  command can't be checked before it runs" and no suggestions, so there is nothing to allow for
  the run. If it connects somewhere, the network ask follows. Two asks for one `for … curl …/$r`
  loop is Claude Code behaviour, not the user's hooks.
- WebFetch asks per URL and suggests `WebFetch(domain:<host>)`.

Web access without asking (D31). A WebFetch ask whose URL host is on `allowedWebFetchDomains`
(14), or a subdomain of one, is answered by the daemon with a plain allow as soon as it arrives.
The item stays `running`; the ask is stored as `allowed` and a `permission.auto_allowed` event
(actor `system`, payload `{ toolName, host, domain }`) records it. Only `http`/`https` URLs without
credentials qualify. The list is never turned into rules in `--settings`: Claude Code shares
`WebFetch(domain:…)` rules with the sandbox's network, so a rule for `github.com` would let
`git push https://github.com/…` from Bash through without an ask. Network asks from Bash keep
asking (D27). Remaining risk, owned by the user per host: a URL can carry repository content out
in its path or query.

Questions (`AskUserQuestion`). The agent's questions to the user arrive as a `can_use_tool` ask
with `input.questions[]`, each `{ question, header, options: [{ label, description, preview? }],
multiSelect }`. A plain allow is no answer: the CLI then tells the agent "The user did not answer
the questions." The answer is an allow whose `updatedInput` is the input plus `answers`, one
string per question keyed by the question's text:

```json
{"behavior":"allow","updatedInput":{"questions":[…],"answers":{"Which color do you prefer?":"Green","Which sizes do you want?":"Small, Large"}}}
```

Several choices are joined with `", "` in the order of the options; text the user typed instead
of an option goes in as typed. The CLI hands them back as the tool result ("Your questions have
been answered: …", recorded in `fixtures/stream/ask-question.jsonl`). The daemon refuses an allow
without an answer for every question, and `answers` on any other tool. Deny declines the
questions with the user's message. The `permission.answered` payload carries `answers`.

### 9.5 Process lifecycle

- One child process per running item.
- Daemon shutdown: first every pending ask of a child is answered with a deny ("donePM is shutting
  down; the ask was not answered."), so the agent does not wait on a question nobody can answer.
  The ask is stored `denied` with that reason and a `permission.answered` event (actor `system`,
  payload `{ behavior: "deny", message, reason }`) is recorded; an item that waited on it is
  interrupted (`agent.interrupted`). Then SIGTERM to all children, wait 5 s, SIGKILL. Items stay
  `running` in the database with their `agentSessionId`.
- Stop button: the same deny first (message "The user stopped the agent; the ask was not
  answered."), then SIGTERM. A question that arrives while the process is closing is denied too.
  No ask is left `pending` for a process that is gone.
- Asks still `pending` at daemon start (crash, kill) become `expired` with the reason "donePM was
  not running when this was asked". The ask row shows the reason after the outcome.
- Daemon start: items in `running` → set to `needs_you` with badge "daemon restarted, resume?".
  Button "Resume" starts the process with `--resume` and sends a short message
  ("Continue where you left off.").
- Process exits non-zero without `result` → item `failed`, store stderr tail (last 50 lines).
- Max concurrent agents: 1 in MVP (configurable constant). Starting a second shows a message.

## 10. MCP server (the draft gate)

The daemon runs a small MCP server over a Unix socket, reached from the agent through a stdio
shim (`donepm-bridge`), exactly like Bloom. The shim is a line relay. All logic is in the
daemon.

Per session: generate a token, write `<tmp>/mcp-<itemId>.json`:

```json
{"mcpServers":{"donepm":{"command":"<path>/donepm-bridge","env":{"DONEPM_TOKEN":"…","DONEPM_SOCKET":"…"}}}}
```

Token maps to one item. Tools listed and allowed depend on the item's playbook `drafts`.

Tools in MVP:

| tool | input | effect |
|---|---|---|
| `draft_pr` | `{ title, body }` | creates Draft `pr`, state `pending`; item → `needs_you`; returns "Draft created, the user will review it." |
| `draft_push` | `{ summary, replies? }` | only after the item's PR exists; the daemon adds the PR, branch and the commits the PR lacks (`git log origin/<branch>..HEAD`); creates Draft `push`, item → `needs_you`. Refused without a PR, or with no commits and nothing uncommitted. `replies`: `[{ body, inReplyTo? }]`, posted after the push (6.9) |
| `draft_comment` | `{ replies }` | replies to review feedback without a push; only after the item's PR exists; creates Draft `comment`, item → `needs_you`. Refused without a PR, without replies, or with an `inReplyTo` that is no known thread (6.9) |
| `draft_review` | `{ verdict, body, comments? }` | only for a `github-pr` item; `verdict` `APPROVE` \| `REQUEST_CHANGES` \| `COMMENT`, a comment `{ path, line, body }`. The daemon adds the PR and the reviewed commit; creates Draft `review`, item → `needs_you`. Refused without a body (except `APPROVE`) or with a line that is not on the new side of `git diff origin/<base>...HEAD` (D43) |
| `whoami` | – | returns item id, branch, worktree path, repo, and `baseBranch` for a review |

A tool call not allowed by the playbook returns an error result (`isError: true`) with text, not a
JSON-RPC error.

## 11. HTTP and WebSocket API

Base: `http://127.0.0.1:6174`. Bind to localhost only.

| method | path | purpose |
|---|---|---|
| GET | `/api/items` | items on the board (archived ones excluded) with state, playbook, repo, `finishedAt` |
| GET | `/api/archive` | archived items, newest archived first (12.5) |
| GET | `/api/items/:id` | item + events + drafts + asks; archived items too |
| POST | `/api/items/:id/start` | create worktree, run setup, start agent |
| POST | `/api/items/:id/playbook` | `{ name }` |
| GET | `/api/items/:id/transcript?after=<id>` | paged transcript |
| POST | `/api/asks/:id/answer` | `{ behavior: allow\|deny, scope?: run\|always, answers?, message? }` |
| GET | `/api/grants` | active "Always allow" grants of every repo (4.5a) |
| POST | `/api/grants/:id/revoke` | sets `revokedAt`; 404 for a missing or removed grant |
| POST | `/api/drafts/:id/edit` | `{ payload }` |
| POST | `/api/drafts/:id/approve` | executes |
| POST | `/api/drafts/:id/reject` | `{ reason }`; reason is sent to the agent as next message. Without a live process (e.g. after a restart) the session is resumed with `--resume` and the reason as its first message |
| POST | `/api/items/:id/resume` | after daemon restart |
| POST | `/api/items/:id/worktree/remove` | only `done` or `failed`; the branch stays |
| POST | `/api/items/:id/ci/rerun` | red CI only; reruns the failed jobs (6.6) |
| POST | `/api/items/:id/ci/done` | `checking` or red CI → `done` |
| POST | `/api/items/:id/ci/fix` | red CI with a session; resumes the agent with the failures |
| POST | `/api/items/:id/conflict/resolve` | waiting merge conflict with a session; fetches the base, resumes the agent (6.7). 202 |
| POST | `/api/items/:id/conflict/dismiss` | waiting merge conflict → back where it was (6.7) |
| POST | `/api/items/:id/feedback/address` | waiting review feedback with a worktree and session; resumes the agent with it (6.9). 202 |
| POST | `/api/items/:id/feedback/dismiss` | waiting review feedback → `done` (6.9) |
| POST | `/api/items/:id/dismiss` | closed upstream, not running → `done` (D32); 409 otherwise |
| GET | `/api/worktrees/orphaned` | worktrees under the root that no item uses |
| POST | `/api/worktrees/orphaned/remove` | `{ path }`; only paths from the orphan list |
| GET | `/api/repos` | |
| POST | `/api/repos/rescan` | |
| GET/PUT | `/api/settings` | PUT is partial; `sources` is replaced as a whole |
| POST | `/api/sources/test` | `{ origin, query }`; runs the query once: `{ count, issues }` (first 10) |
| GET | `/api/status` | CLI detection, daemon version, running agents |

WebSocket `/ws`: server pushes `{ type, payload }` for `item.updated`, `item.removed` (`{ id }`: the
item left the board, e.g. archived), `event.appended`,
`transcript.appended`, `stream.delta`, `status.changed`. UI reloads the affected item on
`item.updated`.

## 12. UI

Vue 3. Four views. Mockups of all four screens are in `docs/screens/` (PNG plus HTML sources, see
its README). Palette: ground `#ECECE8`, card `#FFFFFF`, ink `#141413`,
secondary text `#3F3F3A` / `#66665F`, borders `#C9C9C3` / `#E3E3DE`, primary blue `#1D4ED8`
(tint `#DBEAFE`), needs-you amber `#A14A05` (tint `#FFF3DA`), danger `#991B1B`, diff add `#DCFCE7`,
diff remove `#FBDDDD`. Fonts: IBM Plex Sans, JetBrains Mono.

Header, every view: right side shows the status dot (red problem icon when the daemon has a
problem). Left of it an amber warning triangle with a count appears while at least one item is in
the Needs You column (`columnOf`, so `failed` counts; archived items do not). It is hidden at zero,
links to the board, updates live from `item.updated`, and has an `aria-label` such as "3 items need
you". Amber means "you have something to do"; red stays for daemon problems.

### 12.1 Board

- Four columns: Ready, In Progress, Needs You, Done. Cards: title, repo, external id, labels,
  playbook badge, running indicator, and the agent's tokens as `12.3k in · 4.1k out` (k from 1000,
  one decimal; plain number below 1000; nothing until a `result` reported usage). Input counts
  cached tokens too, as in the Laravel AI SDK; the tooltip shows the cache split.
- Ready card: dropdown for playbook, button "Start". Cards without local repo: greyed out.
- Needs You card: shows what is needed: permission question (tool name, input, Allow / Deny) or
  draft (title, body editable, diff of branch vs base, Approve / Reject with reason) or failure
  (stderr tail, Retry / Remove worktree) or red CI (failed checks with log tails, Fix with agent /
  Rerun failed / Mark done) or a push draft (commits, Approve and push / Reject) or a merge
  conflict ("PR #45 has merge conflicts with main", the files, Resolve with agent / I'll do it
  myself) or review feedback (flag "Review", "PR #45 has review feedback from @ana", Address with
  agent / Read / Mark done) or a reply draft (flag "Reply draft") or a review draft (flag "Review
  draft", "Posting", "Review failed").
- A `github-pr` card carries the badge "PR review" next to its id (D40).
- In Progress card of a `checking` item: "waiting for CI", Mark done.
- Done card: PR link, Remove worktree. With `removeWorktreeOnMerge` on, a quiet note "Worktree is
  removed when PR #45 is merged" (PR linked) until it is; "Not removed: uncommitted changes" when
  the poll kept it (6.5). After the merge: "PR merged". A conflict the user took on: quiet note
  "PR #45 has merge conflicts with main" until GitHub reports it mergeable (6.7).
- Finished card (6.8; the view carries `finishedAt`): muted, lower contrast, no action buttons;
  only opening it. It leaves the board when archived. The Done column header links to the Archive.
- Card of an item closed upstream: note "Closed on GitHub"; on a started, not running item a
  Dismiss button next to it (6.2).
- Sort: one fixed order per column, the same inside every repo lane, so cards do not jump. Ties
  break by external id (numbers in numeric order), so the order is total and stable.

  | column | order | key |
  |---|---|---|
  | Ready | most urgent first, then oldest issue; items without a local clone last | `priority`, then `issueCreatedAt` |
  | In Progress | first started on top; never changes while items run | `startedAt` |
  | Needs You | longest waiting on top | `stateSince` |
  | Done | newest finished on top | `stateSince` |

  Priority tier from the labels (`priorityTier` in `core`, case-insensitive): `P0` / `priority:
  critical` → 0, `P1` / `priority: high` → 1, `P2` / `priority: medium` / no priority label → 2,
  `P3` / `priority: low` → 3. `priority:high`, `priority/high` and `prio: high` match too; with
  several, the most urgent wins. Manual reordering is not supported; it may come back later as an
  override in Ready.

### 12.2 Item detail (drawer or route)

- Right column, top to bottom: Worktree (path, remove button; only when a worktree exists), then
  Timeline of events, newest at top. Each: time, actor, text, link to draft/ask.
- Transcript: full agent conversation, tool calls collapsed, live text while running. The agent's
  text, the task (opened) and a subagent's report render as Markdown in a compact style; the
  user's messages, thinking, tool input and output and setup logs stay plain. Streaming text
  re-renders on every delta; an unclosed code fence shows as code up to the end.
- Diff: `git diff <base>...<branch>` plus uncommitted changes, per file. "Expand all" and
  "Collapse all" next to Refresh open or close every file; each is disabled when it would change
  nothing and both are hidden without files. A new diff resets the state (auto-open up to 400
  changed lines).
- Drafts list. A push draft with replies, and a reply draft, list each reply with what it answers
  ("Reply to @ana on src/a.ts:12" or "Comment on the pull request") and which are posted already.
- A review draft (D43): verdict, summary and each inline comment (`path:line`, body) as Markdown,
  the reviewed commit, Approve and post / Reject with reason. Not editable. The facts line reads
  "reviewing <branch> → <base>".
- Review feedback waiting on the user: each review and comment with author, the file and line and
  the end of the diff hunk for inline ones, a link to GitHub, and Address with agent / Mark done.
- The issue body and the PR draft body render as GitHub-flavoured Markdown (headings, lists, task
  lists read-only, tables, fenced code, quotes, strikethrough, autolinks). The PR draft has Write
  and Preview tabs; Preview shows the unsaved text and is where a new draft opens.
- Markdown is untrusted: raw HTML is off in the parser (`markdown-it`) and the output goes through
  DOMPurify before `v-html`. Links open in a new tab with `rel="noopener noreferrer"`; `javascript:`
  and `data:` URLs never become links. Relative links resolve against
  `https://github.com/<owner>/<repo>/blob/HEAD/`, relative images against `…/raw/HEAD/`; without a
  GitHub repo they stay text. `#123`, `owner/repo#123` and `@user` link to GitHub.
- Images load only from GitHub hosts (`github.com`, `*.githubusercontent.com`); any other image
  shows as a link, since loading it is a request to a third party the user did not make. The
  user's browser loads them, never the agent, so this is outside the draft gate (D2).

### 12.3 Agents (multiplexer)

- Left: list of running and recently finished agents (item title, state, elapsed, cost from
  `result.total_cost_usd`, tokens from `result.usage`). Both count from the start of the `claude`
  process: each process contributes its last value and a new process starts a new sum.
- Elapsed (here and on the card) is the time the agent worked: the sum of its intervals from
  `agent.started`, `agent.resumed`, `agent.turn_started` or `permission.answered` to
  `agent.turn_ended`, `permission.asked`, `agent.interrupted` or `agent.failed`. Waiting on the
  user does not count. A resume continues the sum; a fresh start (new session) begins at 0:00. The
  view carries `agent.elapsedMs` (closed intervals) and `agent.activeSince` (only while the
  process runs), and the UI adds the running interval live.
- Right: transcript of the selected one, live.
- A subagent is one collapsible line under the main agent's flow: type, description, live
  activity and elapsed time while it runs (from `task_progress`), done/failed with tool count and
  duration after. Opened, it shows the model, the subagent's own messages, tool calls and asks,
  and its report. Subagents of subagents nest the same way. A run without subagents looks as before.

### 12.4 Settings

- Repo root, worktree root, branch prefix, port, poll interval, max agents.
- Group "Finished items" (6.8), whole numbers of 0 or more, applied on the next poll:
  - `archiveAfterHours`: "Finished items (done and PR merged, or done without a PR) leave the board
    after this many hours. They stay in the Archive with their agent run. 0 hides them immediately."
  - `deleteAfterDays`: "Archived items, their timeline and their agent transcript are deleted after
    this many days. Items that still have a worktree are kept until it is removed. Empty: never delete."
  - `removeWorktreeOnMerge` (6.5): "When the PR is merged, remove the item's worktree on the next
    poll. Never removes a worktree with uncommitted changes."
- CLI status for `gh` and `claude`, with hints and "Check again".
- Repos list with rescan. Orphaned worktrees.
- Per repo: what it collects (query or "assigned to you"), and an editor with the query field, a
  Test button (count and first titles), "Open in GitHub" (the repo's issue list with this query, to
  refine it there and paste it back) and the assign-on-start checkbox. A failed query shows on its
  row.
- Web access: the hosts the agent may read with WebFetch without asking (9.4), one per line.
- Always allowed (D38): the active grants, grouped by repo (`owner/repo`). Each row shows the rule
  in plain words ("Bash commands matching `pnpm test *`"), the raw rule (`Bash(pnpm test *)`), when
  it was granted, how often and when it was last used, the call it was granted for, and Remove.
  Remove hides the row and stops it matching at once, also for running agents.
- Notifications (per browser, kept in `localStorage`, not in the daemon's config, because the
  browser's own permission is per browser too): a switch "Notify me about new permission asks"
  (on by default) and, while the browser's permission is still undecided, an "Allow browser
  notifications" button (browsers need a user gesture; the page never asks on load).

Pending asks outside the board (#74). Whatever view is open, the tab title is `(n) donePM` while
`n` items wait on a permission ask (the `ask` attention of 12.1) and the favicon gets a red dot;
both clear when the asks are answered. Independently, when the switch is on and the permission is
granted, each ask that newly appears pending raises one `Notification`: title the item's title, body
`Tool: first line of what it wants`, tagged with the ask id. Clicking it focuses the tab and opens
the item. Asks the daemon answers itself (D31 hosts, D38 grants) are never pending, so they never
notify. The ids already announced are kept in `localStorage` (newest 200), so a reload or a second
tab does not announce an ask again; asks that wait when the user grants permission are marked as
announced, not announced in a burst. Works on `127.0.0.1` (a secure context).

### 12.5 Archive

- Route `/archive`, in the top nav and linked from the Done column header.
- Archived items, newest archived first: external id, title, PR link, when archived. A search
  field narrows by title or external id.
- Opening one shows the normal item detail (12.2) with its timeline and transcript.

## 13. CLI

`donepm start` (foreground), `donepm stop`, `donepm status`, `donepm open`
(opens browser), `donepm install-service` (writes launchd plist and loads it).
`donepm uninstall-service` unloads the job and deletes the plist. `stop` sends SIGTERM to the pid
from `/api/status`; the plist uses `KeepAlive: { SuccessfulExit: false }`, so launchd restarts the
daemon after a crash but not after `stop`. The plist records the current `node`, the daemon entry
and `PATH`, because launchd starts jobs with a bare `PATH` and the daemon needs `gh`, `git` and
`claude`.

## 14. Configuration

`~/.config/donepm/config.json`. Created on first start with defaults.

```json
{
  "port": 6174,
  "repoRoot": "~/Code",
  "worktreeRoot": "~/.local/share/donepm/worktrees",
  "branchPrefix": "dp/",
  "pollIntervalSeconds": 60,
  "maxConcurrentAgents": 1,
  "removeWorktreeOnMerge": false,
  "archiveAfterHours": 24,
  "deleteAfterDays": 7,
  "sources": {},
  "allowedWebFetchDomains": ["github.com", "raw.githubusercontent.com", "docs.github.com", "nodejs.org", "developer.mozilla.org", "npmjs.com"]
}
```

`sources` example (4.6):

```json
"sources": {
  "github.com/spatie/bloom": { "query": "is:issue state:open no:assignee", "assignOnStart": true }
}
```

`archiveAfterHours` and `deleteAfterDays` (6.8): whole numbers of 0 or more; `deleteAfterDays:
null` never deletes.

Database: `~/.local/share/donepm/donepm.db`.

## 15. Testing

- `core`: unit tests for every state transition, playbook parsing, placeholder rendering,
  branch naming, origin URL normalisation.
- `daemon`: parser tests against recorded stream-json fixtures (copy the shape of Bloom's
  `Tests/fixtures/session-basic.jsonl`; record own fixtures with a cheap model). Fake process
  factory so runner tests do not spawn `claude`.
- `gh` adapter: tests against recorded JSON output.
- One optional live test behind `DONEPM_LIVE=1` that runs a real agent on a tiny fixture
  repo. Costs money. Not in CI.

## 16. Build and distribution

- `pnpm build` builds `web` into `daemon/public`, compiles TypeScript.
- Single entry: `daemon/dist/index.js`. `donepm-bridge` as a second small binary (Node
  script with shebang is fine for MVP).
- Homebrew tap `donePM/homebrew-tap`: `brew install donepm/tap/donepm`, then
  `donepm install-service` (D29). From source: `pnpm install && pnpm build`, then
  `node packages/cli/dist/main.js`.
- `scripts/pack.sh <version>` packs `pnpm deploy --prod` of `cli` (with `daemon`, its built
  `public/`, its `playbooks/` and `core`) into `dist-release/donepm-<version>.tar.gz`. Each
  package lists what it ships in `files`.
- Pushing a tag `v*` runs `.github/workflows/release.yml`: version from the tag, build, test, pack,
  `donepm --version` on the unpacked tarball, GitHub Release, then the formula rendered from
  `packaging/homebrew/donepm.rb.tmpl` is pushed to the tap with `HOMEBREW_TAP_TOKEN`.
- The formula's `bin/donepm` sets `DONEPM_NODE` and `DONEPM_DAEMON_ENTRY` to Homebrew's `opt`
  paths; `install-service` writes those into the plist, so `brew upgrade` does not break it.

## 17. Open questions

- ~~Does `gh search issues --assignee=@me` return bodies, or is a second call per issue needed?~~
  Answered (gh 2.102.0, #2): it returns `body`; one call is enough. Default `--limit` is 30, so
  the daemon passes `--limit 1000`.
- Does the installed `claude` still accept `--permission-prompt-tool stdio`? Bloom measured it on
  2.1.x. Verify first, before building the runner.
- Diff in the UI: render with a library (e.g. `diff2html`) or own component? Start with the
  library.
- Where does the agent commit? Playbook tells it to commit. If it does not, the daemon commits
  with "WIP from donePM" before push. Decide after first live runs.

## 18. Build order

1. `core`: item, event, draft, state machine, playbook parser. Tests.
2. `daemon`: SQLite schema, config, repo scan, `gh` detection and polling. Items appear in
   `/api/items`.
3. `web`: board with Ready and Done columns, settings page. Read only.
4. `daemon`: worktree create, setup, agent runner with stream-json parser. Transcript stored.
5. `web`: agents view with live transcript.
6. `daemon`: MCP server, bridge shim, `draft_pr`. Permission asks.
7. `web`: Needs You column with ask and draft cards, approve flow.
8. `daemon`: execution of approved PR drafts via `gh`.
9. Resume after restart, reconcile worktrees, failure handling.
10. CLI, launchd, first week of real use.
