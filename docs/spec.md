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
| source | `github-issue` \| `github-pr` \| `jira-issue` \| `ado-work-item` | `github-pr`: a pull request that requests the user's review (D40); `jira-issue`: a Jira ticket (6.12); `ado-work-item`: an Azure Boards work item (6.13) |
| externalId | string | `owner/repo#123`; `host/owner/repo#123` on a GitHub host other than github.com (6.10); `<connection>:<KEY>` for a ticket (`jira:APP-123`, 6.12; `ado:1234`, 6.13) |
| repoCandidates | string[]? | a ticket's repositories by normalised origin, the union of its ticket sources' `repos` (6.12); absent for GitHub items |
| repoOrigin | string? | a ticket's repository: the only candidate, or the user's choice (`item.repo_chosen`); fixed once the agent started |
| externalUrl | string | |
| repoId | uuid | |
| title | string | |
| body | string | raw issue body |
| labels | string[] | |
| state | enum | see 4.2 |
| playbook | string | playbook name, default `implement`; `review` for `github-pr` |
| priority | int | tier from GitHub's "Priority" issue field, else from the labels, 0 most urgent (see 6.2, 12.1, D45); recomputed on every poll |
| issueCreatedAt | datetime? | when the issue was opened upstream (6.2) |
| startedAt | datetime? | first `start`; kept on retry and through Needs You |
| stateSince | datetime | when the item entered its current state; transitions that keep the state leave it |
| worktreePath | string? | set when agent starts |
| branch | string? | |
| baseBranch | string? | a review's PR base, set when its worktree is created (D41); else the repo's default branch is the base |
| agentSessionId | string? | Claude `session_id`, for `--resume` |
| author | string? | `github-pr`: the PR author's login, `dependabot[bot]` for Dependabot (D47) |
| prStatus | object? | `github-pr`: `{ state, closedAt?, mergeable, base, reviewDecision?, viewerReview?, checks? }` in GitHub's words, read each poll (6.2, D47) |
| autoMerge | boolean? | `github-pr`: the card's "Merge automatically"; absent: the repo's `autoMerge` decides (6.2, D47) |
| autoMergeHeld | object? | `github-pr`: `{ head, mergeState }` of the PR when an auto-merge failed for a passing reason; it waits until either changes (6.2, D47) |
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
`repliesPosted(item)`, `reviewPosted(item)` (needs_you → done, D43), `reviewedPrMerged(item)` (`github-pr`,
ready or done → done, D47), `archived(item, finishedAt)` (only from `done`, once; sets `archivedAt`, 6.8).
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
`pr.feedback_dismissed` (see 6.9), `pr.commented` (actor `user`, payload `{ body }`: the user posted a
comment on someone else's PR from its card, 6.2, D47), `pr.branch_updated` (actor `user`, payload
`{ via }`: the user clicked Update branch on the card, 6.2, D47), `pr.merged` (payload `{ method, auto }`;
actor `user` for the card's Merge, `system` for auto-merge), `pr.merge_failed` (actor `system`,
payload `{ method, auto, error, staysOn }`: auto-merge failed; `staysOn` false: it was turned off
for the item, true: the reason passes and it stays on, held) and
`pr.auto_merge_set` (actor `user`, payload `{ on }`), all 6.2 and D47, `item.repo_chosen` (actor
`user`, payload `{ origin }`: the user picked a ticket's repository, 6.12), `item.archived` (actor `system`,
payload `{ finishedAt }`, see 6.8), `item.refreshed` (actor `system`, payload `{ changed: {
priority?, title?, labels? } }`, each `{ from, to }` and only the fields that changed, see 6.2). `agent.resumed` carries
`reason: "ci_failed"` when the user let the agent fix a red CI, `reason: "pr_conflict"` when it
resolves a merge conflict, `reason: "pr_feedback"` when it addresses review feedback. `worktree.removed` carries `reason: "pr_merged"` and actor `system` when the poll removed it.

### 4.4 Draft

| field | type | notes |
|---|---|---|
| id | uuid | |
| itemId | uuid | |
| type | `pr` \| `push` \| `comment` \| `review` \| `update_branch` \| `ticket_comment` \| `ticket_transition` | |
| payload | JSON | for `pr`: `{ title, body, base }`; for `push`: `{ summary, number, url, branch, commits, uncommitted, replies? }`; for `comment`: `{ number, url, replies }`. A reply is `{ body, inReplyTo? }` (6.9); for `review`: `{ number, url, commitId, verdict, body, comments }`, a comment `{ path, line, body }` (D43); for `update_branch`: `{ number, url, base, via, reason }`, `via` `dependabot` \| `update-branch` (6.2, D47); for `ticket_comment`: `{ key, url, body }`; for `ticket_transition`: `{ key, url, transitionId, toStatus, comment? }` (6.12) |
| state | `pending` \| `approved` \| `rejected` \| `executed` \| `failed` | |
| userEdits | JSON? | the payload after user edits |
| result | JSON? | for `pr`: `{ url, number }`; for `push`: `{ sha, posted? }`; for `comment`: `{ posted }`; for `review`: `{ id, url }`; for `update_branch`: `{ via, url? }` (`url` of the Dependabot comment); for `ticket_comment`: `{ id, url? }`; for `ticket_transition`: `{ status }`. `posted` lists `{ index, url }` per reply out, written after each one so a retry skips them |

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
| originUrl | string | normalised: `github.com/owner/repo`; Azure Repos: `dev.azure.com/org/project/repo`, lower case, blanks kept (6.11) |
| defaultBranch | string | from `git symbolic-ref refs/remotes/origin/HEAD` |
| setup | JSON? | from `.donepm/setup.yml`, see 7.3 |

What donePM collects for a repo is the user's business, not the repo's: it lives in the user
config under `sources`, keyed by `originUrl`, not in `.donepm/` (see 14). Per repo:

| field | type | notes |
|---|---|---|
| query | string? | the provider's issue search, pasted from its UI. Absent: issues assigned to me |
| assignOnStart | boolean | default `false`; see 6.4 |
| managed | boolean | default `false`: donePM collects and starts work only in managed repos (D46) |
| autoMerge | boolean? | default `false`: default of the card's "Merge automatically" for others' PRs (6.2, D47) |
| mergeMethod | `squash` \| `merge` \| `rebase`? | default `squash`: how others' PRs are merged here (6.2, D47) |
| playbook | string? | default playbook of issues newly collected here (8.3); absent: chosen by `match`. Must be one of `playbooks.issue` when that is set. Pull requests keep `review` (D40) |
| agent | `claude-code` \| `codex`? | the coding agent items here run with, unless the playbook names one (D49). Absent: `claude-code` |
| playbooks | `{ issue?: string[], pr?: string[] }`? | the playbooks each ingest may run here (8.3, D48). Absent `issue`: every playbook that is not read-only. Absent `pr`: `["review"]`. `pr` only ever takes read-only playbooks (D47) |
| ci | `{ source: "azure-pipelines", definitions: number[], organization?, project? }`? | pipelines that run in Azure Pipelines without reporting to the host: CI is read from their builds by branch instead of the PR's checks (6.6, D53). `organization` and `project` default to an Azure Repos origin's own; any other origin names them, and a connection must serve the organization. Only the config file sets it; the settings form keeps it |

The provider follows from the host: a `sources` key is accepted only when a connection (14, D50)
serves its host, and for `dev.azure.com` its organization. Without a `connections` config that is `github.com` alone. GitLab (issue list
params via `glab api`) and Jira (JQL) can be added without changing the format.

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
- Match issues to repos by normalised origin URL. Issues of a managed repo (4.6) without a local
  repo are shown in Ready with a "no local clone" badge and cannot be started, but can be cloned.
  Issues of unmanaged repos without a local clone are not collected; Settings lists those repos as
  found on GitHub (6.2) with "Clone and manage".
- Clone (issue #37): for a `github.com` origin, the daemon (never the agent)
  runs `gh repo clone <owner>/<repo> <repoRoot>/<owner>/<repo>`. Read-only towards GitHub and the
  user's click, so no draft. `gh` uses the user's auth and protocol and sets `upstream` for forks.
  Every other host clones below its host name, so equal names on two hosts never meet:
  `gh repo clone <host>/<owner>/<repo> <repoRoot>/<host>/<owner>/<repo>` for GitHub Enterprise,
  `git clone https://dev.azure.com/<org>/<project>/_git/<repo> <repoRoot>/dev.azure.com/<org>/<project>/<repo>`
  for Azure Repos (6.11, D52). A GitHub Enterprise clone made before #141 at
  `<repoRoot>/<owner>/<repo>` is still recognised as its origin's clone.
  - Target exists: a clone of the same origin is registered without cloning; an empty folder is
    cloned into; anything else (a clone of another origin, a repo without origin, a folder with
    files, a file) is refused with 409 and never touched.
  - Success: the clone is registered directly in `repos`, independent of the scan rules, and every
    item of the origin is relinked. A rescan keeps a stored clone that sits at
    its clone path (above) of its own origin even where the scan does not look (an owner
    named `vendor` or starting with `.`).
  - Failure: nothing is registered; the stderr tail stays on the items until the next try.
  - One clone per origin at a time. `.donepm/setup.yml` (7.3) applies per worktree, not here.

## 6. GitHub adapter

The daemon reaches providers through three roles, each an interface in `daemon/src/providers/`
(D50):

- `TicketSource`: the default searches, a repository's query, fields, ticket state, assign.
- `CodeHost`: clone, pull requests, review feedback, replies, reviews, merge, update branch.
- `CiSource`: checks, failed logs, rerun.

A connection (14) picks the adapter and its backend: `cli` (a logged-in tool) or `api` (REST with a
Keychain token, D8). The registry finds a role by the host of an origin or URL. A host with no
connection gets "no connection for <host>". GitHub through `gh` is the first adapter, and it
implements all three roles. The rest of this section is that adapter. Status lists one entry per
connection, `{ id, kind, backend, state, detail? }`, where `state` is one of `not_installed`,
`not_logged_in`, `unreachable`, `unauthorized` or `ready`. `status.gh` stays as it was. An `api`
connection's entry also has `tokenSet`; without a token it is `unauthorized` and nothing is sent.

### 6.1 Detection

On start and on Settings open:

- `which gh` → found or not.
- `gh auth status` → logged in or not.
- Show state in Settings: `not installed` / `not logged in` / `ready`. Show `brew install gh`
  and `gh auth login` as copyable hints. Button: "Check again".
- Alongside, `claude` (`which`, `--version`, `auth status`) and the optional helpers (`which <cmd>`,
  `<cmd> --version`; today `playwright-cli`). A missing helper only shows as such (12.4).

### 6.2 Polling

- Every 60 seconds (configurable).
- Command:
  ```
  gh search issues --assignee=@me --state=open --json id,number,title,body,createdAt,labels,repository,url
  ```
  If `gh search` is not available, fall back to `gh issue list --assignee @me --json ...` per
  known repo.
- Review requests (D40), same poll, same fields and schema:
  ```
  gh search prs --review-requested=@me --state=open --json number,title,body,createdAt,labels,repository,url
  ```
  and the pull requests assigned to the user (D47), Dependabot's included, also with `author`:
  ```
  gh search prs --assignee=@me --state=open --json number,title,body,createdAt,labels,repository,url,author
  ```
  Each becomes a `github-pr` item with playbook `review` and the PR's `author` login; a PR found by
  both searches is one item. Without `gh search prs` there are no pull requests, not an error. A closed or merged PR is found like a closed issue: `gh issue view
  --json state` answers `MERGED` for a merged PR, which counts as closed.
- PR status (D47). At the end of each poll, for every `github-pr` item that is managed, not
  archived, not closed upstream and not known to be merged or closed (done ones too: a reviewed PR
  is still open), one call per 50
  reads where the pull request stands, by repository and number, so PRs that left the searches are
  still read:
  ```
  gh api graphql -f query='query { pr0: repository(owner: "o", name: "r") { pullRequest(number: 88) {
    number state closedAt mergeable mergeStateStatus headRefOid reviewDecision viewerLatestReview { state } baseRefName
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } ... }'
  ```
  The answer becomes the item's `prStatus`; a changed one is saved and pushed, without an event
  (it is display). gh exits 1 when one PR does not resolve but answers for the others; those are
  used. A failure leaves the stored status as it is.
- Merge (D47). Someone else's PR may be merged once nothing blocks it (`mergeBlockers` in `core`):
  state `OPEN`, the item `ready` or `done`, the user's own review `APPROVED`, checks (if any)
  `SUCCESS`, `mergeable` `MERGEABLE`, and `mergeStateStatus` not `BEHIND` (branch protection wants
  the branch up to date with its base: "the branch is behind <base>; waiting for it to be updated"),
  all as of the last poll. The card's Merge runs
  `gh pr merge N --repo host/o/r --squash|--merge|--rebase` as the user, without
  `--delete-branch` (the author's branch is theirs), and commits `reviewedPrMerged`. After the PR
  status and the CI watch, each poll merges every such PR whose item has auto-merge on (its own
  `autoMerge`, else the repo's), with the repo's `mergeMethod`. A failed auto-merge records
  `pr.merge_failed`. A refusal that passes on its own (`mergeFailurePasses` in `core`: not up to
  date with the base branch, base or head branch modified, required checks pending or expected,
  mergeability unknown) keeps `autoMerge` as it was and sets `autoMergeHeld` to the PR's `head`
  and `mergeStateStatus`; it is tried again once either differs (`autoMergeDue`), or when the user
  ticks the box again. Any other refusal turns `autoMerge` off for that item, so it is not retried
  every poll.
- Update branch (issue #148, D47). While the last poll read someone else's open PR as `BEHIND`
  (`branchUpdateBlocker` in `core`), the card offers Update branch; the click is the approval. A
  Dependabot PR (author `dependabot[bot]`) gets the comment `@dependabot rebase` (`gh pr comment`),
  since a push by anyone else makes Dependabot stop maintaining it. Any other PR gets
  `gh pr update-branch N --repo host/o/r`, GitHub's "Update branch", a merge of the base (not
  `--rebase`, which rewrites the author's commits). It records `pr.branch_updated`; the state stays.
  The review agent can propose the same with `draft_update_branch` (6.3).
- Validate output with a schema (zod). On schema failure: log the raw output, do not crash, show
  an error badge in Settings.
- Priority (D45). After all sources answered, one call per 100 polled issues reads GitHub's
  "Priority" issue field by the issues' node ids (`id` above; pull requests have no issue fields):
  ```
  gh api graphql -f query='query { nodes(ids: [...]) { ... on Issue { id issueFieldValues(first: 20) {
    nodes { ... on IssueFieldSingleSelectValue { name field { ... on IssueFieldSingleSelect { name } } } } } } } }'
  ```
  The option of the field named "Priority" (any case) gives the tier: `Urgent` / `Critical` / `P0`
  → 0, `High` / `P1` → 1, `Medium` / `Normal` / `P2` → 2, `Low` / `P3` → 3. No field, or an option
  of another name → the labels decide (12.1). gh exits 1 when one id does not resolve but answers
  for the others; those are used. A GitHub without issue fields (the query names an unknown field)
  counts as "no field". Any other failure leaves the priority of known items as it is, rather than
  falling back to the labels for one poll; new items take the labels. A failing lookup is not a
  failing source. The issue type and Projects v2 fields are not read (D45).
- Upsert items by `externalId`. New issue → `item.collected` event, state `ready`. A known item
  takes over title, body, labels, URL and priority; a changed priority, title or label set (not the
  order) adds one `item.refreshed` event naming only what changed, so the timeline can say
  "Priority changed on GitHub: P2 → P1". Body and URL change silently. Items the poll does not
  return (done, archived, or no longer assigned or matching their query) are not refreshed; they
  are only checked for closing (D45). Closed issue
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
- Managed repos only (D46). The searches above stay one call each and return issues of every
  repo; those of unmanaged repos are dropped. Unmanaged repos without a local clone are counted
  per origin into `lastPoll.discovered` (`{ origin: count }`) for Settings. Without a `gh search`,
  the per-repo fallback runs for managed repos only. Items of unmanaged repos are not checked for
  closing and leave the board unless running, `needs_you`, or holding an open ask or draft; nothing
  is deleted, and managing the repo again brings them back.
- Managed repos with a `query` (4.6) are polled in addition, one call each:
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

An `update_branch` draft (issue #148) updates the branch like the card's Update branch (6.2):
`@dependabot rebase` for Dependabot, else `gh pr update-branch`. Result `{ via, url? }`, then
`draft.executed` moves the item `needs_you` → `running` and the agent is told to go on with its
review: a live process hears it, otherwise its session is resumed. The review draft still comes
after it. A failure stops the draft with step `update_branch`. Rejected, the agent is told to leave
the branch and finish the review.

### 6.4 Assign on start

When the item's repo has `assignOnStart`, `start` also runs
`gh issue edit <n> --repo <owner/repo> --add-assignee @me` in the background and records
`item.assigned` or `item.assign_failed` (with the reason). Neither changes the state; a failure does
not stop the agent. The daemon runs this, never the agent (decision D28). Only for `github-issue`
items: a PR under review is someone else's. Jira tickets (6.12) and Azure Boards work items (6.13)
are assigned through their ticket source when its entry has `assignOnStart`.

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

Azure Pipelines (issue #143, D53). The PR's code host is the one authority for its checks: `gh pr
checks` on GitHub and GitHub Enterprise, the PR's policy evaluations on Azure Repos (6.11). Every
check then goes through `countOnce` before the verdict: checks linking to the same Azure Pipelines
build (`dev.azure.com/<org>/<project>/_build/results?buildId=N` or `<org>.visualstudio.com/...`,
project name or id), and the same job when the link has `jobId`, are one check; the attempt that
started last wins, then a finished one, then the one finished last. Other checks stay as they are.

- A failed check linking to an Azure Pipelines build gets its log and rerun from the
  `azure-devops` connection serving that build's organization, whatever hosts the PR; without one
  it has no log and its rerun says "no connection for the Azure DevOps organization …". Every other
  failed check goes to the host as above.
- Logs: `GET {project}/_apis/build/builds/{id}/timeline`, the failed `Task` records with a log, in
  order, only those under the link's job when it names one; then `GET .../logs/{logId}` per task
  (text, or JSON `{ value: [lines] }`), last 40 lines, timestamps, ANSI and BOM stripped. A check
  with several failed tasks gets each under a `── <task> ──` header.
- Rerun: from the timeline, the failed `Stage` records; `PATCH .../builds/{id}/stages/{identifier}`
  with `{ state: "retry", forceRetryAllJobs: false }` per stage, which reruns the failed jobs only.
  A build without a failed stage says so. The run key in `ci.failed`/`ci.started` is the build's
  canonical URL; GitHub Actions runs keep their id.
- `sources[origin].ci` (4.6): pipelines that do not report to the host. For such a repository the
  watch never reads the PR's checks; it lists `GET {project}/_apis/build/builds?definitions=…&
  branchName=refs/heads/<branch>&queryOrder=queueTimeDescending&$top=50`, keeps the newest build
  per definition of the worktree's `HEAD` commit (any commit when `HEAD` cannot be read), and maps
  `status`/`result`: not `completed` → pending, `succeeded`/`partiallySucceeded` → pass, `canceled`
  → cancel, anything else → fail. A definition without such a build has no check yet, so the 60 s
  grace applies as for late checks.

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

- **Resolve with agent** (needs a session): the daemon fetches the base and the PR branch
  (`git fetch origin <base> <branch>`, the agent has no network), then resumes the session
  (`agent.resumed`, reason `pr_conflict`) with the base and the files as message. The agent first
  merges `origin/<branch>`, which brings in commits only GitHub has (e.g. from "Update branch") so
  the push stays a fast-forward, then `origin/<base>` (no rebase, so the push does not rewrite the
  PR), runs the tests, commits, and calls `draft_push`. After the push the item waits for CI (6.6).
- **I'll do it myself**: `pr.conflict_dismissed` (actor `user`), item back to `from`. The card shows
  a quiet note "PR #n has merge conflicts with main" until the conflict ends.

### 6.8 Retention

Part of each poll, after the CI watch and the PR state, also while `gh` is not ready (D37). The
clock is the daemon's `Ctx`, so tests move it.

- **Finished**: `done`, and the PR merged if a draft opened one (`item.pr_merged`, or
  `worktree.removed` with reason `pr_merged`). A done item without a PR (closed upstream,
  dismissed, marked done) is finished when it became done. `finishedAt` is the later of the
  merge and `stateSince`. A PR closed without merge never finishes the item. A `github-pr` item
  (D47) whose PR is still open is not finished; once its `prStatus` says merged or closed, it is
  finished at the later of `closedAt` and `stateSince`.
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

- **Address with agent** (needs a worktree and a session): the daemon fetches the PR branch
  (`git fetch origin <branch>`, the agent has no network), then resumes the session
  (`agent.resumed`, reason `pr_feedback`) with every entry, inline ones with `path:line`, thread
  number and the end of their diff hunk. The agent first merges `origin/<branch>`, which brings in
  commits only GitHub has (a committed suggestion, "Update branch") so the push stays a
  fast-forward, then changes what is needed, commits, and calls `draft_push` with
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

### 6.10 Other GitHub hosts

GitHub Enterprise Server and GHE.com work like github.com, through the same `gh` (issue #140).
Each host is one `github` connection with its `host` (`gitHubCliConnection(exec, host, id)`);
github.com is the one there is without a `connections` config. Which hosts the user enables is
configured with connections (issue #138).

- An item off github.com keeps its host in `externalId`: `github.acme.com/team/app#7`, so two
  repositories of the same name on two hosts never merge. github.com ids stay `owner/repo#N`.
- `gh` is logged in to each host on its own: detection runs `gh auth status --hostname <host>` per
  host. github.com's state is `status.gh`, the others are `status.ghHosts[host]`; Settings shows a
  row per host with `gh auth login --hostname <host>` as the hint.
- `gh search` takes no `--hostname`: the poll sets `GH_HOST=<host>` for the searches of each
  host. `gh api` takes `--hostname <host>` (issue fields, PR status, feedback, replies, reviews).
  Every `--repo` names the host off github.com (`host/owner/repo`), and so does `gh repo clone`.
- A host that is not logged in, or whose searches fail, is skipped and reported; the other hosts
  are polled. Its items are not checked for closing until it answers again. CI, auto-merge and PR
  watching go per host too: a PR waits while its own host is not ready.
- Settings > Tools lists the connections with their `ConnectionStatus`, and offers every host
  `gh auth status --json hosts` reports as logged in as one more `github` connection. Using one
  saves `connections` and applies after a restart. It does not touch `allowedWebFetchDomains`.
- The agent's environment drops `GH_HOST` and the tokens, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN` included, and `gh` stays
  behind the same shim and empty config directory as on github.com: GitHub Enterprise is no way
  out either.

### 6.11 Azure DevOps Repos

Azure Repos on Azure DevOps Services is a code host (issue #141, D52). One `azure-devops`
connection serves one organization on `dev.azure.com`; several organizations are several
connections. Azure DevOps Server (on premises) is out of scope.

- Origins: `https://dev.azure.com/org/project/_git/repo`, `https://org@dev.azure.com/...`,
  `git@ssh.dev.azure.com:v3/org/project/repo` and `https://org.visualstudio.com/project/_git/repo`
  all normalise to `dev.azure.com/org/project/repo`, lower case, `%20` decoded to a blank. A PR's
  web URL is `https://dev.azure.com/org/project/_git/repo/pullrequest/<id>`.
- Backends: `cli` calls the REST API through `az rest --resource 499b84ac-…` with the user's
  `az login`; `api` calls it with a personal access token from the Keychain (D50) as Basic auth.
  The REST calls are the same either way, `api-version=7.1`. A 401 or a 203 sign-in page is
  `unauthorized`, no answer is `unreachable`.
- Health: `cli` runs `az --version` (else `not_installed`) and `az account show` (else
  `not_logged_in`, "run az login"); `api` reads `_apis/connectionData` and shows the token's user.
  The watchers skip a `cli` connection whose last health check was not ready.
- Clone (5): `git clone` of the https URL by the daemon, `GIT_TERMINAL_PROMPT=0`, with the user's
  git credential helper.
- PR draft (6.3): the daemon pushes the branch, then `POST
  {project}/_apis/git/repositories/{repo}/pullrequests` with `refs/heads/` source and target, the
  title, and the body as `description`, shortened to Azure DevOps' 4000 characters with a note.
  The result is `{url, number}` from `pullRequestId`.
- PR state (6.5): `GET .../pullrequests/{id}`. `status` `active` → `OPEN`, `completed` →
  `MERGED` (`closedDate` as `mergedAt`), `abandoned` → `CLOSED`; `mergeStatus` `conflicts` →
  `CONFLICTING`, `succeeded` → `MERGEABLE`, anything else `UNKNOWN`. An unknown `status` throws.
- CI (6.6, issue #143): `GET .../pullrequests/{id}` for the project id, then `GET
  {project}/_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{id}`
  (`api-version=7.1-preview.1`). Enabled Build and Status policies are checks; reviewer and other
  policies are not. `approved` → pass, `rejected`/`broken` → fail, `notApplicable` → skipping,
  anything else pending. A build policy is named by its `displayName`, else its pipeline, and links
  to its build; a status policy by `genre/name`.
- Not yet: review feedback (6.9), replies, posting reviews, merging others' PRs and updating a
  branch say "not supported on Azure DevOps yet"; others' PRs (D47) are not read there.
- The agent never reaches it: `az` is filtered from `PATH` and denied (`Bash(az *)`), `git push`
  is denied whatever the remote, `AZURE_DEVOPS_EXT_PAT` is dropped and `AZURE_CONFIG_DIR` points at
  an empty directory.

### 6.12 Jira tickets

Issue #139, D51, D55. A `jira` connection is a ticket source only: code and pull requests stay on
the repository's code host.

- **Ticket sources.** `ticketSources` (14) lists queries against a Jira connection, each with the
  repositories its tickets are worked in. Each poll runs every entry's JQL (default
  `assignee = currentUser() AND statusCategory != Done`) with paging: Cloud `GET
  /rest/api/3/search/jql` with `nextPageToken`, Data Center `GET /rest/api/2/search` with
  `startAt`/`maxResults`, 100 a page, at most 10 pages. Fields are listed explicitly, with
  `expand=renderedFields`.
- **Mapping.** `externalId` `<connection>:<KEY>`, `externalUrl` `<baseUrl>/browse/<KEY>`. The body is
  the rendered description HTML turned into Markdown with scripts, styles, frames and forms
  dropped; the UI sanitises it again (12.2) and links no `@name` or `#123` in it. Labels are the
  labels, components and the issue type. Priority by name: Highest/Blocker 0, High/Critical 1,
  Medium/Major 2, Low/Lowest/Minor/Trivial 3, anything else 2. Done tickets
  (`statusCategory.key = done`) are not collected.
- **Repository.** A ticket's candidates are the union of the `repos` of the entries that found it.
  With one, the item is linked to it. With several, it waits in a "Choose a repository" lane
  until the user picks one on the card (`POST /api/items/:id/repo`, core `repoChosen`, event
  `item.repo_chosen`); Start answers 409 until then. The choice can change until the agent first
  starts. A ticket is on the board when its chosen repository, or any candidate before the
  choice, is managed (D46).
- **Naming.** Branch `dp/<KEY>-<slug>`; the PR title starts with the key (`APP-123: …`).
- **Closed upstream.** Missing tickets are checked in batches of 100 with `key in (…)`,
  `fields=status`; `done` closes them as in 6.2. When Jira refuses the batch (400, e.g. a deleted
  key), each key is read alone (`GET /issue/<KEY>?fields=status`); a 404 stays undecided.
- **Assign on start** (6.4): when the entry for the item's repository has `assignOnStart`, `PUT
  /issue/<KEY>/assignee` with the `accountId` (Cloud) or `name` (Data Center) of `/myself`.
- **Errors.** A 429 ends that connection's searches for the poll, with the `Retry-After` in the
  error; its items are left as they are. Other failures are a source error as in 6.2.
- **Ticket drafts** (D56). A playbook with `ticket` in `drafts` gives the agent
  `draft_ticket_comment` and `draft_ticket_transition` (10), always for the item's own ticket.
  A transition is named by id, name or target status and checked when the draft is created against
  `GET /issue/<KEY>/transitions?expand=transitions.fields`; one Jira does not offer is refused with
  the list it does, and so is one with required fields that have no default (other than a comment).
  Nothing goes to Jira before approval. Approved, the daemon posts `POST /issue/<KEY>/comment`, or
  `POST /issue/<KEY>/transitions` with the comment in the same call; the body is Markdown turned
  into ADF for Cloud (v3) and wiki markup for Data Center (v2). Like `update_branch` (6.3), the
  draft needs no worktree, `draft.executed` moves the item `needs_you` → `running` and the agent
  goes on. A failure stops the draft with step `ticket`.
- The agent never reaches Jira: the daemon holds the token (D51); outward effects are drafts.

### 6.13 Azure Boards work items

Issue #142, D57. An `azure-devops` connection (6.11) is also a ticket source: `ticketSources` (14)
entries may name it like a Jira connection. All calls go through the connection's transport
(`az rest` or the REST API with the Keychain token), `api-version=7.1`.

- **Ticket sources.** Each entry's WIQL (default: assigned to `@Me`, state not `Closed`, `Done`,
  `Removed`, `Completed` or `Cut`, newest change first) runs as `POST {project}/_apis/wit/wiql?$top=200`,
  in the entry's `project` when it has one (the default then adds `[System.TeamProject] =
  @project`), else across the organization. A link query's targets are the work items. The ids
  of all entries are read together with `POST _apis/wit/workitemsbatch`, 200 at a time,
  `errorPolicy: omit` (a work item that cannot be read is left out), with the fields listed.
- **Finished.** A state's category, read once per project and work item type from `GET
  {project}/_apis/wit/workitemtypes/{type}/states`, decides: `Completed` and `Removed` are
  finished, anything else is open, also a category donePM does not know. Finished work items are
  not collected and close their item upstream (6.2); one whose category cannot be read stays
  undecided.
- **Mapping.** `externalId` `<connection>:<id>`, shown as `#1234`; `externalUrl` the work item's
  `_links.html`, else `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}`. The body is the
  description, then the acceptance criteria and the repro steps under their own headings, each
  HTML turned into Markdown as for Jira. Labels are the tags and the work item type.
  `Microsoft.VSTS.Common.Priority` 1–4 is tier 0–3, anything else 2.
- **Repository and naming** as for Jira (6.12): candidates from the entries' `repos`, branch
  `dp/<id>-<slug>`. The PR title is the agent's; the work item is linked instead: a GitHub PR's
  description gets `AB#<id>` on its own line (the Azure Boards app for GitHub links it), an Azure
  Repos PR of the same organization is created with `workItemRefs`.
- **Assign on start** (6.4): `GET _apis/connectionData` for the signed-in user's account, then
  `PATCH _apis/wit/workitems/{id}` (`application/json-patch+json`) setting `System.AssignedTo`.
- **Ticket drafts** (`draft_ticket_comment`, `draft_ticket_transition`, D56) work on work items
  too. `ticket_transitions` lists every other state of the work item's type, each with the state's
  name as its id. Approved, a comment is `POST
  {project}/_apis/wit/workItems/{id}/comments?format=markdown` (`7.1-preview.4`); a move is a
  `System.State` patch, then its comment as a second call. Nothing reaches Azure DevOps before the
  user approves, and the agent never reaches it (6.11).

## 7. Worktrees

### 7.1 Location

`worktreeRoot`, default `~/.local/share/donepm/worktrees/`. Path per item:
`<worktreeRoot>/<repo-slug>/<branch-slug>/`.

Changing the root (#93, D44). New worktrees go to the new root. Items' worktrees under the old one,
review worktrees (D41) included, are not left behind silently: `PUT /api/settings` with a new root
answers 409 with the list (`worktreesAtOldRoot`: item, title, path, whether an agent runs in it) and
saves nothing until the user chooses, by `?worktrees=move` or `?worktrees=leave`. Move runs, per
item, `git -C <main clone> worktree move <old> <new>` with the same relative path under the new
root, so git's metadata follows. It never touches a worktree an agent works in, never overwrites an
existing target, and skips a missing worktree or a failed `git`; each skip comes back with its
reason. A moved item gets the new `worktreePath` and an event `worktree.moved { from, to }`
(actor `user`); its state and `agentSessionId` stay, and a later resume runs `claude --resume` in
the new directory. Leave keeps every path as it is; those items go on working there. Either way the
old root is kept in `previousWorktreeRoots` (14) so orphans there are still found (7.5), until
nothing donePM knows is left under it.

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
not in the database, under the worktree root or a former one (`previousWorktreeRoots`, 7.1) → show in
Settings as "orphaned" with a remove button. Items whose worktree
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
| agent | no | the coding agent that runs it: `claude-code` or `codex` (D49, D54). Absent: the repo's `agent`, else `claude-code`. The other fields are checked against that agent's capabilities |
| model | yes | passed to `--model` |
| effort | no | passed to `--effort` |
| permission_mode | yes | `default` \| `acceptEdits` \| `plan` \| `bypassPermissions` |
| read_only | no | `true`: no edit or web tools, project settings not loaded (9.1, D42); needs `permission_mode: default` and no `pr` draft |
| drafts | yes | list of allowed draft types: `[pr]`, `[review]`, `[pr, ticket]`; `pr` also allows `draft_push` and `draft_comment`, `ticket` allows `draft_ticket_comment`, `draft_ticket_transition` and `ticket_transitions` (6.12). The default `implement` has `[pr, ticket]` |
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
- A repo's `sources[origin].playbook` (4.6) wins for its newly collected issues; existing items
  keep theirs.
- A repo's `sources[origin].playbooks` (4.6, D48) limits what each ingest may run: issues get the
  listed ones (default: every playbook that is not read-only), pull requests the listed read-only
  ones (default: `review`). A new item starts with the repo's default playbook if it is allowed,
  else the built-in default (`implement`, `review`) if allowed, else the first allowed by name.
  Core's `allowedPlaybooks` computes the set; the item view carries it as `allowedPlaybooks`.
- User changes via dropdown → `item.playbook_changed` event. The transition throws for a playbook
  outside the allowed set.

## 9. Agent runner

The runner speaks to every coding agent through one seam (issue #136, D49). An adapter
(`daemon/src/agent/adapter.ts`) builds the process's arguments and maps each stdout line to neutral
events (`AgentEvent` in `core`): session bound, turn started, message, raw, live, tool started and
finished, ask, usage, turn ended. It also puts user turns and ask answers into the agent's own words.
The runner acts on those events only; it holds no agent's protocol, tool names or program name.
Asks are stored with the agent that asked and a neutral subject (command, file change, network,
question, tool) that the ask panel draws from; transcript lines carry the agent whose protocol they
are in. "Allow for this run" rules, "Always allow" grants and the WebFetch auto-allow apply only to
an agent that reports rules or a fetch host and has the capability; any other agent asks every time.
Claude Code is the first adapter (`agent/claude/`); the rest of this section describes it. Codex
(`agent/codex/`, issue #137) is the second: `codex app-server --listen stdio://` over JSON-RPC, its
sandbox a permission profile on the command line, `plan` and `bypassPermissions` refused, "Allow for
this run" its own `acceptForSession`, no "Always allow", and donePM's MCP server registered as
`donepm-draft-gate` with the token in a 0600 file (D54, D50). Its transcript lines get their own
presenter in the web (`transcript/codex-rows.ts`).

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
  `allowUnsandboxedCommands: false`, `filesystem.allowWrite` for the user's cache directories, and
  `filesystem.denyRead` for `~/Library/Keychains` (D50, #170). The permissions also deny
  `Read(~/Library/Keychains/**)` and, as defence in depth only, `security` spelled out by path or
  behind `env`, `command`, `exec` or `xcrun`.
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
| `draft_update_branch` | `{ reason }` | only for a `github-pr` item the last poll read as `BEHIND` its base; creates Draft `update_branch`, item → `needs_you`. Approved, the daemon updates the branch (6.2, 6.3) and the agent goes on with its review. Allowed where the playbook allows `review` drafts |
| `draft_ticket_comment` | `{ body }` | only for a ticket item (6.12); creates Draft `ticket_comment` on the item's own ticket, item → `needs_you`. Approved, the daemon posts it and the agent goes on. Allowed where the playbook allows `ticket` drafts |
| `draft_ticket_transition` | `{ to, comment? }` | only for a ticket item; `to` is a transition's id or name, or the status it leads to, checked against Jira now; creates Draft `ticket_transition`, item → `needs_you`. Approved, the daemon moves the ticket and the agent goes on |
| `ticket_transitions` | – | lists the transitions the item's ticket offers now, read-only. Allowed with `ticket` drafts |
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
| POST | `/api/items/:id/start` | create worktree, run setup, start agent; 409 when the repo is not managed (D46) |
| PUT | `/api/items/:id/playbook` | `{ playbook }`: the card's playbook choice, `item.playbook_changed`; only on a `ready` item that never started (409 otherwise), 400 for a playbook the item's repo does not have, 409 for one the repo does not offer the item's ingest (D48) |
| POST | `/api/items/:id/say` | `{ text }`: a note from the user to the running agent, written to its stdin as the next user message; it joins the running turn. 409 when the agent is not running, 400 for an empty or too long note |
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
| POST | `/api/items/:id/conflict/resolve` | waiting merge conflict with a session; fetches the base and the PR branch, resumes the agent (6.7). 202 |
| POST | `/api/items/:id/conflict/dismiss` | waiting merge conflict → back where it was (6.7) |
| POST | `/api/items/:id/feedback/address` | waiting review feedback with a worktree and session; fetches the PR branch, resumes the agent with it (6.9). 202 |
| POST | `/api/items/:id/feedback/dismiss` | waiting review feedback → `done` (6.9) |
| POST | `/api/items/:id/pr/comment` | `{body}`: `gh pr comment` on a `github-pr` item's PR as the user, `pr.commented`; 502 with gh's message when it fails (D47) |
| POST | `/api/items/:id/pr/update-branch` | Update branch on a `github-pr` item's PR as the user (`@dependabot rebase` or `gh pr update-branch`), `pr.branch_updated`; 409 unless the last poll read it `BEHIND`, 502 with gh's message (6.2, D47) |
| POST | `/api/items/:id/pr/merge` | `{method}`: `gh pr merge` on a `github-pr` item's PR, `pr.merged`; 409 with the blockers, 502 with gh's message (6.2, D47) |
| PUT | `/api/items/:id/auto-merge` | `{on}`: the item's "Merge automatically", `pr.auto_merge_set` (D47) |
| POST | `/api/items/:id/dismiss` | closed upstream, not running → `done` (D32); 409 otherwise |
| GET | `/api/worktrees/orphaned` | worktrees under the root that no item uses, with `branch`, `sizeBytes` and `lastCommitAt` when known |
| POST | `/api/worktrees/orphaned/remove` | `{ path }`; only paths from the orphan list |
| GET | `/api/repos` | each with `managed` (D46) and `worktrees`, the number of items with a worktree there |
| POST | `/api/repos/rescan` | |
| POST | `/api/repos/clone` | `{ origin }`; clones into `<repoRoot>/<owner>/<repo>` (5). 202 `{ origin, path, result: "started" }`, the outcome arrives as `repo.*` pushes; 200 with `result: "cloned"` when a clone of the origin was at the target already; 400 for an origin donePM cannot clone; 409 while it clones, when it has a clone, or the target is occupied. A clone makes the origin managed (D46) |
| PUT | `/api/repos/:id` | `{ managed: boolean }`; manages or stops managing the repo's origin (D46). Managing polls at once |
| PUT | `/api/connections/:id/token` | `{ token }`: writes the `api` connection's token to the Keychain (D51); answers `{ id, tokenSet: true }`, never the token. 400 for a `cli` connection, 404 for an unknown id, 502 when the Keychain refuses |
| DELETE | `/api/connections/:id/token` | removes it: `{ id, tokenSet: false }` |
| POST | `/api/connections/:id/test` | checks a saved connection now, before a restart: `{ id, ok, state, detail?, tokenSet?, deployment? }` (Jira: `serverInfo`, then `/myself`) |
| GET/PUT | `/api/settings` | PUT is partial; `sources` is replaced as a whole. A new `worktreeRoot` with item worktrees under the old one needs `?worktrees=move\|leave`, else 409 `{ worktreesAtOldRoot }` and nothing saved; with move the answer has `worktrees: { moved, skipped }` (7.1) |
| POST | `/api/sources/test` | `{ origin, query }`; runs the query once: `{ count, issues }` (first 10) |
| POST | `/api/items/:id/repo` | `{ origin }`: a ticket's repository among its candidates, `item.repo_chosen` (6.12). 400 for an origin that is no candidate, 409 once the agent started, 404 for an unknown item |
| POST | `/api/ticket-sources/test` | `{ connection, query? }`: runs the JQL once: `{ ok: true, count, issues }` (first 10, `{ externalId, title, url }`) or `{ ok: false, error }`; 409 when the connection is not running yet |
| GET | `/api/status` | CLI detection (`gh`, `claude`, and `helpers` by id: installed, path, version), daemon version, pid, `startedAt`, running agents, last poll and scan, `pollErrors` (the last 5 failed polls, newest first) |
| GET | `/api/playbooks` | `{ globalDir, playbooks, problems }`: global playbooks, then each repo's own with `scope` and `overridesGlobal`; each with its frontmatter, `match`, `body`, the MCP `tools` its drafts offer, its starting `permissions` (`allow`, `deny`), and for a global copy of a shipped playbook `builtIn` (`default` or `edited`); broken files as problems (12.4) |
| GET | `/api/daemon` | version, pid, port, `startedAt`, `service` (`launchd` \| `manual`), config, database path and size, log file (launchd only), playbooks folder |
| POST | `/api/daemon/restart` | 202, then exits with 75 so launchd starts it again (13); 409 when started by hand |
| POST | `/api/daemon/open` | `{ what: logs\|playbooks }`: opens the log file or the global playbooks folder in Finder; 409 when there is none |

WebSocket `/ws`: server pushes `{ type, payload }` for `item.updated`, `item.removed` (`{ id }`: the
item left the board, e.g. archived), `event.appended`,
`transcript.appended`, `stream.delta`, `status.changed`, `repo.cloning` and `repo.cloned`
(`{ origin, path }`), `repo.clone_failed` (`{ origin, path, error }` with the stderr tail). UI
reloads the affected item on `item.updated`; every item of the origin gets one when a clone starts,
finishes or fails. An item without a clone that donePM can clone carries
`clone: { origin, target, cloning?, error? }`. A `checking` item carries `ci: { checks }`, the PR's
checks from the last CI watch poll (`name`, `bucket` as `gh pr checks` reports it, `startedAt` while
pending); the daemon keeps them in memory only, so they are absent until the first poll after a start.

## 12. UI

Vue 3. Four views. Mockups of the main screens in light and dark are in `docs/screens/` (PNG plus
HTML sources, see its README). All colours are tokens in `packages/web/src/theme.css`; components
use only the tokens. Light: ground `#FAFAFA`, card `#FFFFFF`, muted `#F4F4F5`, ink `#09090B` /
`#3F3F46` / `#6B6B76`, borders `#E4E4E7` / `#D4D4D8`, primary indigo `#4F46E5` (tint `#EEF2FF`),
needs-you amber `#B45309` (tint `#FFFBEB`), ok green `#15803D` (only CI and merges), danger
`#DC2626` (bug labels, failures, diff removals), diff add `#DCFCE7`, diff remove `#FEE2E2`. Dark:
ground `#09090B`, card `#18181B`, ink `#FAFAFA`, primary `#6366F1`, amber `#FBBF24`, green
`#4ADE80`, danger `#F87171`; tints are the same hues at 12–18% alpha. Code blocks stay dark in both
themes. Fonts: IBM Plex Sans, JetBrains Mono.

Theme: one button in the header, right of the status, cycles **system → light → dark → system**.
Its icon shows the current choice (monitor, sun, moon); its `aria-label` names the current choice
and the next one ("Theme: system. Switch to light"). Default is system: `prefers-color-scheme`
decides, and an OS change is followed live. Light and dark ignore the OS. The choice is per browser
(`localStorage` key `donepm.theme`; an unknown value means system), not daemon state. An inline
script in `index.html` sets `dark` on `<html>` before first paint, so a reload does not flash.
`color-scheme` follows the theme, so native controls and scrollbars match. The favicon follows the
OS only; a page cannot choose its favicon by class.

Waiting for CI (`checking`, D35): a small round dot in needs-you amber stands before "Waiting for
CI" on the card, in the CI panel heading and in the item's state badge. It pulses gently (opacity and
scale only, no layout shift) and stays static under `prefers-reduced-motion: reduce`.

Header, every view: brand disc and "donePM" on the left, then nav links with icons (Board, Agents
with a badge counting running agents, Archive, Settings). Right side: an amber pill "3 need you"
while at least one item is in the Needs You column (`columnOf`, so `failed` counts; archived items
do not). It is hidden at zero, links to the board, updates live from `item.updated`, and has an
`aria-label` such as "3 items need you". Then the status dot with the poll text ("polled 12 s ago";
red problem icon when the daemon has a problem), then the theme switch. Amber means "you have
something to do"; red stays for daemon problems. Icons are inline SVG components in
`packages/web/src/icons/`, no icon library.

Layout: the document never scrolls. The app fills the window; each view scrolls inside it, so there
is exactly one vertical scrollbar per view (the Agents view has one per pane on a desktop and one
for the whole view on a phone). Every scroll container is positioned, so visually hidden labels
(`.sr`) stay inside it instead of stretching the document. Views other than the board load lazily.

### 12.1 Board

- Four columns: Ready, In Progress, Needs You, Done. Column headers are uppercase with a count;
  Needs You is amber; In Progress reads "3 · 2 agents" while agents run. Below 1050px the four
  columns keep their width and the board scrolls sideways; on a phone the columns stack per lane.
- Lanes: one per repository, header with a chevron, the repo name in mono and "5 items". A
  collapsed lane shows a summary instead ("2 ready · 1 needs you · 1 done") and a badge with the
  number of open Dependabot PRs.
- Card: the number (`#45`) top left, at most one badge top right (`cardBadge`): what the user is
  asked for (PR draft, push draft, replies draft, review draft, permission, CI failed, conflict,
  review, interrupted, failed), else merged / closed upstream / done, else "PR · <author>" on a
  `github-pr` item, else the first label (bug red, feature indigo). Then the title and the other
  labels. Cost (`$0.41`) shows on cards; tokens only on the item page and in the Agents view. An
  agent that reports no price (Codex) shows its tokens on the card instead, never `$0.00` (D54).
- Card variants: running (indigo border, "running · 6:12" with a dot, branch and current tool in
  mono, Transcript / Stop, cost); waiting for CI (pulsing dot, one badge per check, green with a
  tick when passed, "name · 1:20" while pending, PR link); PR draft (amber card, "waiting 14 min",
  Review draft); conflict ("PR #45 conflicts with main in 2 files. Who resolves it?", Agent / I'll
  do it, PR link); permission (tool, input as a code block, Allow / Allow for this run / Deny…);
  merged (green badge, PR link, "worktree removed · $0.65"); no clone and closed upstream are ghost
  cards with a dashed border.
- Ready card: a select "implement · opus" (global playbooks plus the repo's own, a repo playbook
  overriding a global one of the same name, limited to the item's `allowedPlaybooks`, D48; a plain
  label when there is only one) and "Start" with a play icon. The select is enabled
  only on a ready item that never started; a change is saved at once (`PUT
  /api/items/:id/playbook`). Once Codex is installed, a second select picks the agent ("Claude
  Code" or "Codex", showing the one the next start uses) on a ready or failed item; a change is
  saved at once (`PUT /api/items/:id/agent`) and drops the item's session (D49). Cards without local repo: greyed out, with
  "No local clone under <repoRoot>" and a Clone button (5) whose tooltip names the target. While
  it clones the button reads "Cloning…" and is disabled; a refused or failed clone shows its
  message under it. Once cloned the card links the clone and Start appears, no rescan needed.
- Needs You card: shows what is needed: permission question (tool name, input, Allow / Deny) or
  draft (title, body editable, diff of branch vs base, Approve / Reject with reason) or failure
  (stderr tail, Retry / Remove worktree) or red CI (failed checks with log tails, Fix with agent /
  Rerun failed / Mark done) or a push draft (commits, Approve and push / Reject) or a merge
  conflict ("PR #45 has merge conflicts with main", the files, Resolve with agent / I'll do it
  myself) or review feedback (flag "Review", "PR #45 has review feedback from @ana", Address with
  agent / Read / Mark done) or a reply draft (flag "Reply draft") or a review draft (flag "Review
  draft", "Posting", "Review failed").
- A `github-pr` card carries the badge "PR · <author>" next to its id (D40, D47), and chips for its
  `prStatus`: "Conflicts", the checks ("CI green", "CI failed", "CI running") and the user's own
  review ("You approved", "You asked for changes", "Not reviewed by you"). On a conflict, "Ask
  author" opens a comment prefilled with `@dependabot rebase` for Dependabot, else a request to
  resolve the conflicts with the base; the user edits it, and "Post comment" is the approval
  (D47). donePM never pushes to the author's branch. Below the chips: the merge method (the repo's
  `mergeMethod` preselected), Merge (disabled while something blocks it, the blockers in its
  tooltip) and the checkbox "Merge automatically" (the view's `merge: { blockers, auto, method }`).
- A card whose priority is not the default P2 shows the tier as a badge next to its id: `P0` and
  `P1` in danger colours, `P3` quiet (D45). A priority changed on GitHub moves a Ready card within
  one poll, and its timeline shows the `item.refreshed` event.
- In Progress card of a `checking` item: pulsing CI pending dot, "waiting for CI", Mark done.
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

  Priority tier (`issuePriority` in `core`, D45): GitHub's "Priority" issue field when it is set
  to a known option (6.2), else from the labels. A field set on GitHub wins over a priority label.
  From the labels (`priorityTier` in `core`, case-insensitive): `P0` / `priority:
  critical` → 0, `P1` / `priority: high` → 1, `P2` / `priority: medium` / no priority label → 2,
  `P3` / `priority: low` → 3. `priority:high`, `priority/high` and `prio: high` match too; with
  several, the most urgent wins. Manual reordering is not supported; it may come back later as an
  override in Ready.

### 12.2 Item detail (drawer or route)

- Without a local clone: "No local clone. Clone lands in <target>" under the title, with the same
  Clone button as the card (12.1).
- Head: crumb "← Board / owner/repo #45" with the state badge, the title, and a mono line with the
  playbook badge, branch → base, commits, +/− lines, worked time and cost, tokens, and the link to
  the issue or PR.
- Tabs: Draft (Overview when no draft waits), Changes with the number of changed files, Transcript
  (opens the item in the Agents view), Timeline. The tab is in the query (`?tab=changes`).
- Right column, top to bottom: Worktree panel (mono path, Finder / Terminal, Remove; session id and
  "resumable"; only when a worktree exists), then Timeline of events, newest at top (not repeated
  while the Timeline tab is open). Each entry: a dot, the actor in bold ("You", "Agent", "System")
  and what happened, then "14:02 · 11 min · $0.86 · 48.2k in / 6.1k out" (duration, cost and
  tokens on a finished turn).
- PR draft panel: amber border, "by agent · 14:02 · you can edit before publishing", Write / Preview
  tabs, Approve and publish, and a note of what approving runs ("commit leftovers · git push · gh pr
  create", D25).
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
- Markdown is untrusted. Embedded HTML renders like on GitHub (Dependabot's `<details>` release
  notes, `<kbd>`, `<sub>`), and the output goes through DOMPurify before `v-html`: no scripts,
  event handlers, SVG, `<style>` or `style=`, forms, iframes, media or `srcset`; `id` and `name`
  get a `user-content-` prefix. Links and images in raw HTML follow the same rules as Markdown
  ones. Links open in a new tab with `rel="noopener noreferrer"`; `javascript:`
  and `data:` URLs never become links. Relative links resolve against
  `https://github.com/<owner>/<repo>/blob/HEAD/`, relative images against `…/raw/HEAD/`; without a
  GitHub repo they stay text. `#123`, `owner/repo#123` and `@user` link to GitHub.
- Images load only from GitHub hosts (`github.com`, `*.githubusercontent.com`); any other image
  shows as a link, since loading it is a request to a third party the user did not make. The
  user's browser loads them, never the agent, so this is outside the draft gate (D2).

### 12.3 Agents (multiplexer)

- Left: agents in groups Running, Waiting for CI, Waiting for you, Finished today (finished before
  today are left out, at most 10). Each entry: "repo #45" in mono, the title, and a state line
  with a dot ("running · 6:12 · $0.41", "2 of 4 checks · 1:20", "PR draft · 14 min", "permission ·
  Bash", "merged · $0.65"). Header of the selected one: id and title, a mono line with branch,
  playbook, tokens and session; buttons Card, Changes and Stop. Below the transcript, while the
  agent runs, a composer "Send a note to the agent · joins the running turn" (`POST
  /api/items/:id/say`). Tool calls are bordered pills, a subagent's pill is dashed, a running call
  has an indigo border, and live text ends in a caret.
- Cost comes from `result.total_cost_usd`, tokens from `result.usage`. Both count from the start of the `claude`
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

Routes `/settings/<section>`, `/settings` opens General. A section nav on the left, grouped
Workspace (General, Repositories with the number of clones), Agents (Agents & access, Playbooks) and
System (Tools, Daemon); Agents & access and Tools each carry a status dot; below 820 px it sits above the content. Each section is a
page with a title, one lead line and panels; each panel saves on its own.

- **General.** "Folders and branches": repo root, worktree root, branch prefix. Saving a new
  worktree root while item worktrees are under the old one (7.1) opens a dialog: "N worktrees are in
  the old location. Move them to the new one?", the items listed with their paths, those with a
  running agent marked and noted as staying where they are. Buttons: Move, "Leave them where they
  are", Cancel (nothing saved). After a move the form says how many moved and names each one not
  moved with its reason. "Finished items" (6.8), whole numbers of 0 or more, applied on the next poll:
  - `archiveAfterHours`: finished items (done and PR merged, or done without a PR) leave the board
    after this many hours and stay in the Archive. 0 hides them immediately.
  - `deleteAfterDays`: archived items with their timeline and transcript are deleted after this
    many days, unless they still have a worktree. Empty: never delete.
- **Repositories.** The lead names the repo root and when it was last scanned. A table of the
  managed clones (D46) with a filter, "Show ignored (n)" for the unmanaged ones (muted, badge
  "ignored"; shown without asking while nothing is managed, so a fresh install can pick) and
  Rescan. Columns: repository with its path, base branch, source query (or "assigned to you") with
  the last poll's result or error, options as badges (assigns on start, the default playbook, the
  playbooks offered per ingest when not the default, merges automatically, `setup.yml`), the number of worktrees, Edit. Edit opens a row below with the query
  field, Test (count) and "Open in GitHub" (the repo's issue list with this query, to refine it
  there and paste it back), the default playbook (8.3, only among those offered for issues),
  checkboxes for the playbooks offered for issues (any) and for pull requests (read-only ones,
  D48), and switches for assign on start (6.4),
  "Ignore this repository" (= not managed), and for others' PRs "Merge automatically" with the merge
  method (D47); Save and Cancel. "Without a clone" lists managed repos that have no local clone
  ("Stop managing") and repos the poll found on GitHub without a clone, with their item count and
  "Clone and manage". "Worktrees without an item" (hidden when empty) lists orphaned worktrees,
  former roots included, with size, branch, last commit and Remove.
- **Agents & access.** "Coding agents": `claude` with path, version, login and hints, and "Check
  again"; `codex` the same way, muted while not installed because it is optional (#137). Its dot
  is amber while a coding agent is not ready.
  "Running agents": max agents, poll interval, `removeWorktreeOnMerge` (6.5:
  removes the worktree on the next poll after the merge, never with uncommitted changes), and the
  notifications switch (below). "Permissions" (D38): the active grants with the rule, its repo
  (`owner/repo`), when it was granted, how often it was used, and Revoke, which stops it matching at
  once, also for running agents; below, "Always denied": the blocked CLIs and `git push`, fixed.
  "Web access": the hosts the agent may read with WebFetch without asking (9.4), as removable chips
  with an input to add one; a host covers its subdomains. Saved on each change.
- **Playbooks.** One table of the playbooks (8.1) with name and file, model, effort, permission
  mode, drafts (and "read only"), and origin: global, "in owner/repo", or "overridden in
  owner/repo"; a shipped playbook the user changed is marked "edited". "Open folder" opens the
  global folder. View opens a row below with the playbook's content, read-only (#154): the file,
  where it comes from (built-in unchanged, built-in edited, the user's own file, or a repository's
  `.donepm/playbooks`), what it fits (`match`), model and effort, permission mode, read-only access
  (D42), the donePM MCP tools its drafts offer, the permission rules the agent starts with (allowed
  without asking, always denied), and the prompt rendered as Markdown with its placeholders. Files
  that fail to load are listed with their error. Editing happens in the files; an editor in the UI
  is a later step.
- **Tools.** One panel with "Check again", grouped: "Source clients", the CLIs work is collected and
  drafts are executed with (`gh` with path, login and hints; muted rows for Jira, #139, and Azure
  DevOps, #141), and "Helpers", optional CLIs an agent may use (`playwright-cli` with path and
  version; missing is muted, with its install command, never a problem). Every tool has one
  category (coding agent, source client, helper) and is shown on one page only: coding agents under
  Agents & access (#152). "Polling": what is collected, how often, the last poll's result, and the
  last failed polls since the daemon started. Its dot covers the source clients and the last poll.
- **Daemon.** Version, service (launchd or by hand), address, pid and uptime, database path and
  size, config file, log. "Open logs" and "Restart" only under launchd. The port, applied after a
  restart.

Notifications (per browser, kept in `localStorage`, not in the daemon's config, because the
browser's own permission is per browser too): a switch "Browser notification and tab badge when an
agent needs you" (on by default, applies at once) and, while the browser's permission is still
undecided, an "Allow browser notifications" button (browsers need a user gesture; the page never
asks on load).

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

`donepm token set <connection>` reads an `api` connection's token from stdin, or from a prompt
that does not echo, and hands it to the daemon; `donepm token delete <connection>` removes it
(D51). The token is never an argument.

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
  "github.com/spatie/bloom": { "managed": true, "query": "is:issue state:open no:assignee", "assignOnStart": true },
  "github.com/acme/widgets": { "managed": true, "assignOnStart": false, "playbook": "fix", "playbooks": { "issue": ["implement", "fix"], "pr": ["review"] } },
  "github.acme.com/team/api": { "managed": true, "assignOnStart": false, "ci": { "source": "azure-pipelines", "organization": "acme", "project": "Platform", "definitions": [41, 77] } }
}
```

`connections` (6, D50): optional, read at start. `PUT /api/settings` takes it and answers
`restartRequired: true` when it changed; the running daemon keeps its connections until then.
Absent, it means one connection, github.com through `gh`:

```json
"connections": [
  { "id": "github", "kind": "github", "backend": "cli", "host": "github.com" },
  { "id": "acme", "kind": "github", "backend": "cli", "host": "github.acme.com" },
  { "id": "jira", "kind": "jira", "backend": "api", "baseUrl": "https://acme.atlassian.net", "deployment": "cloud", "email": "dana@acme.com" },
  { "id": "ado", "kind": "azure-devops", "backend": "cli", "organization": "acme" }
]
```

`id` is lower case letters, digits and dashes, and unique. The host (`host`, or the host of
`baseUrl`) is unique, except that `azure-devops` connections share `dev.azure.com` and their
`organization` is unique instead. `kind` is `github`, `jira` or `azure-devops`. `backend` is `cli`
or `api`, and each kind takes only the backends it has: for `github`, only `cli`; for `jira`, only
`api`; for `azure-devops`, both (D52). An `azure-devops` connection has an `organization` (lower
cased) and `host` `dev.azure.com`, which is its default. A `jira`
connection has an https `baseUrl` (a context path is fine), `deployment` `cloud` or `datacenter`,
and for `cloud` the `email` the API token belongs to (D51). An `api` connection's token is in the macOS Keychain, service `donepm`, account `id`.
It is never in this file.

`ticketSources` (6.12, 6.13): default `[]`. Each entry names a `jira` or `azure-devops`
connection, an optional `query` (JQL or WIQL; absent: the tickets assigned to me that are not
done), for Azure Boards an optional `project` the query runs in, its `repos` (normalised origins,
at least one, each served by a code host connection) and `assignOnStart`. Changes apply at once
and poll now.

```json
"ticketSources": [
  { "connection": "jira", "query": "project = APP AND sprint in openSprints()", "repos": ["github.com/acme/app", "github.com/acme/api"], "assignOnStart": true },
  { "connection": "ado", "project": "Platform", "repos": ["dev.azure.com/acme/platform/web"] }
]
```

`archiveAfterHours` and `deleteAfterDays` (6.8): whole numbers of 0 or more; `deleteAfterDays:
null` never deletes.

`previousWorktreeRoots` (7.1): kept by the daemon, not set through the settings API; former
worktree roots that may still hold worktrees. Default `[]`.

Database: `~/.local/share/donepm/donepm.db`.

## 15. Testing

- `core`: unit tests for every state transition, playbook parsing, placeholder rendering,
  branch naming, origin URL normalisation.
- `daemon`: parser tests against recorded stream-json fixtures (copy the shape of Bloom's
  `Tests/fixtures/session-basic.jsonl`; record own fixtures with a cheap model). Fake process
  factory so runner tests do not spawn `claude`.
- `gh` adapter: tests against recorded JSON output.
- Provider adapters (D50): every adapter passes the contract suite of each role it implements
  (`daemon/src/test-support/contracts/`), in two scenarios: the provider answers with recorded
  fixtures, and the provider refuses every call. CLI backends run on `fakeExec` and API backends on
  `fakeHttp`, which records each request's method, path and body. The Keychain store is tested
  with `fakeExec`, never against the real Keychain.
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
