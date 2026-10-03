# Spec: donePM MVP

See `intent.md` for the why. This file says what to build. MVP only.

## 1. Scope

In scope:

- Source: GitHub issues assigned to the current user, via `gh`.
- Repositories: found by scanning one root folder.
- Board with four columns: Ready, In Progress, Needs You, Done.
- One agent type: Claude Code, run as a child process, in a git worktree.
- One playbook: `implement`. Playbooks are Markdown files.
- One draft type: `pr`. The user approves it. The daemon pushes and creates the PR.
- Agent permission questions shown as cards.
- Live agent transcript in the UI.
- Settings: repo root, worktree root, port, CLI status.
- Event log per work item, shown as a timeline on the card.
- CLI: `donepm start|stop|status`.

Out of scope for the MVP: Jira, GitLab, review playbook, review feedback, schedules, Dependabot,
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
| source | `github-issue` | more later |
| externalId | string | `owner/repo#123` |
| externalUrl | string | |
| repoId | uuid | |
| title | string | |
| body | string | raw issue body |
| labels | string[] | |
| state | enum | see 4.2 |
| playbook | string | playbook name, default `implement` |
| priority | int | from labels or manual; MVP: manual sort order |
| worktreePath | string? | set when agent starts |
| branch | string? | |
| agentSessionId | string? | Claude `session_id`, for `--resume` |
| createdAt, updatedAt | datetime | |

### 4.2 Item states

```
ready → running → needs_you → running → ... → done
                ↘ failed
```

| state | column | meaning |
|---|---|---|
| ready | Ready | collected, no agent yet |
| running | In Progress | agent turn is open |
| needs_you | Needs You | agent waits: permission question, or a draft is pending |
| done | Done | draft `pr` was approved and executed |
| failed | Needs You | agent exited with error; card shows stderr tail and offers retry |

Transitions are functions in `core`: `start(item)`, `agentAsked(item)`, `answered(item)`,
`draftCreated(item)`, `draftApproved(item)`, `draftExecuted(item)`, `draftExecutionFailed(item)`,
`draftRejected(item)`, `agentFailed(item)`.
Invalid transitions throw.

### 4.3 Event

Append-only. Never updated or deleted.

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
`agent.turn_started`, `agent.turn_ended`, `agent.failed`, `permission.asked`, `permission.answered`, `draft.created`,
`draft.edited`, `draft.approved`, `draft.rejected`, `draft.executed`, `draft.execution_failed`.

### 4.4 Draft

| field | type | notes |
|---|---|---|
| id | uuid | |
| itemId | uuid | |
| type | `pr` | more later |
| payload | JSON | for `pr`: `{ title, body, base }` |
| state | `pending` \| `approved` \| `rejected` \| `executed` \| `failed` | |
| userEdits | JSON? | the payload after user edits |
| result | JSON? | for `pr`: `{ url, number }` |

### 4.5 PermissionAsk

| field | type |
|---|---|
| id | uuid |
| itemId | uuid |
| requestId | string (from CLI) |
| toolName | string |
| input | JSON |
| state | `pending` \| `allowed` \| `denied` |

### 4.6 Repo

| field | type | notes |
|---|---|---|
| id | uuid | |
| path | string | local clone |
| originUrl | string | normalised: `github.com/owner/repo` |
| defaultBranch | string | from `git symbolic-ref refs/remotes/origin/HEAD` |
| setup | JSON? | from `.donepm/setup.yml`, see 7.3 |

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
  gh search issues --assignee=@me --state=open --json number,title,body,labels,repository,url
  ```
  If `gh search` is not available, fall back to `gh issue list --assignee @me --json ...` per
  known repo.
- Validate output with a schema (zod). On schema failure: log the raw output, do not crash, show
  an error badge in Settings.
- Upsert items by `externalId`. New issue → `item.collected` event, state `ready`. Closed issue
  that is not `done` → keep item, add badge "closed upstream".
- Never delete items automatically.

### 6.3 Execution (after draft approval)

Run by the daemon, never by the agent:

```
git -C <worktree> push -u origin <branch>
gh pr create --repo <owner/repo> --head <branch> --base <base> --title <t> --body-file <tmp>
```

Store the PR URL in the draft result. Add `draft.executed` event. Set item to `done`.

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

### 7.3 Setup per repo

Optional file in the repo: `.donepm/setup.yml`

```yaml
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

Not automatic in the MVP. Button on a `done` or `failed` card: "Remove worktree". Runs
`git worktree remove --force <path>` and `git worktree prune`. Branch is kept.

### 7.5 Reconcile on start

On daemon start: for each repo, `git worktree list --porcelain`. Compare with items. Worktrees
not in the database → show in Settings as "orphaned" with a remove button. Items whose worktree
is missing → mark `failed` with reason.

## 8. Playbooks

### 8.1 Files

- Global: `~/.config/donepm/playbooks/*.md`
- Per repo: `<repo>/.donepm/playbooks/*.md`. Same name overrides global.
- Ship one built-in default `implement.md`, written to the global folder on first start if
  missing.

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
| permission_mode | yes | `acceptEdits` \| `plan` \| `bypassPermissions` |
| drafts | yes | list of allowed draft types; MVP: `[pr]` |
| match.source | no | source filter |
| match.labels | no | any of these labels |

Body: the first user message. Placeholders: `{{ externalId }}`, `{{ title }}`, `{{ body }}`,
`{{ labels }}`, `{{ branch }}`, `{{ repoPath }}`.

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
- The same `--settings` allows `mcp__donepm`: its tools only create drafts, so a permission
  question per call would ask the user twice for the same thing.

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

### 9.4 Permission answer

```json
{"type":"control_response","response":{"request_id":"<id>","subtype":"success","response":{"behavior":"allow","updatedInput":<input>}}}
```

or `"behavior":"deny","message":"<text>"`. `request_id` must match. After answering: item back
to `running`.

### 9.5 Process lifecycle

- One child process per running item.
- Daemon shutdown: SIGTERM to all children, wait 5 s, SIGKILL. Items stay `running` in the
  database with their `agentSessionId`.
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
| `whoami` | – | returns item id, branch, worktree path, repo |

A tool call not allowed by the playbook returns an error result (`isError: true`) with text, not a
JSON-RPC error.

## 11. HTTP and WebSocket API

Base: `http://127.0.0.1:6174`. Bind to localhost only.

| method | path | purpose |
|---|---|---|
| GET | `/api/items` | all items with state, playbook, repo |
| GET | `/api/items/:id` | item + events + drafts + asks |
| POST | `/api/items/:id/start` | create worktree, run setup, start agent |
| POST | `/api/items/:id/playbook` | `{ name }` |
| GET | `/api/items/:id/transcript?after=<id>` | paged transcript |
| POST | `/api/asks/:id/answer` | `{ behavior: allow\|deny, message? }` |
| POST | `/api/drafts/:id/edit` | `{ payload }` |
| POST | `/api/drafts/:id/approve` | executes |
| POST | `/api/drafts/:id/reject` | `{ reason }`; reason is sent to the agent as next message |
| POST | `/api/items/:id/resume` | after daemon restart |
| POST | `/api/items/:id/worktree/remove` | |
| GET | `/api/repos` | |
| POST | `/api/repos/rescan` | |
| GET/PUT | `/api/settings` | |
| GET | `/api/status` | CLI detection, daemon version, running agents |

WebSocket `/ws`: server pushes `{ type, payload }` for `item.updated`, `event.appended`,
`transcript.appended`, `stream.delta`, `status.changed`. UI reloads the affected item on
`item.updated`.

## 12. UI

Vue 3. Three views. Mockups of all four screens are in `docs/screens/` (PNG plus HTML sources, see
its README). Palette: ground `#ECECE8`, card `#FFFFFF`, ink `#141413`,
secondary text `#3F3F3A` / `#66665F`, borders `#C9C9C3` / `#E3E3DE`, primary blue `#1D4ED8`
(tint `#DBEAFE`), needs-you amber `#A14A05` (tint `#FFF3DA`), danger `#991B1B`, diff add `#DCFCE7`,
diff remove `#FBDDDD`. Fonts: IBM Plex Sans, JetBrains Mono.

### 12.1 Board

- Four columns: Ready, In Progress, Needs You, Done. Cards: title, repo, external id, labels,
  playbook badge, running indicator.
- Ready card: dropdown for playbook, button "Start". Cards without local repo: greyed out.
- Needs You card: shows what is needed: permission question (tool name, input, Allow / Deny) or
  draft (title, body editable, diff of branch vs base, Approve / Reject with reason) or failure
  (stderr tail, Retry / Remove worktree).
- Done card: PR link, Remove worktree.
- Sort: manual drag within a column (priority). Persist order.

### 12.2 Item detail (drawer or route)

- Timeline of events, newest at top. Each: time, actor, text, link to draft/ask.
- Transcript: full agent conversation, tool calls collapsed, live text while running.
- Diff: `git diff <base>...<branch>` plus uncommitted changes, per file.
- Drafts list.

### 12.3 Agents (multiplexer)

- Left: list of running and recently finished agents (item title, state, elapsed, cost from
  `result.total_cost_usd`).
- Right: transcript of the selected one, live.

### 12.4 Settings

- Repo root, worktree root, branch prefix, port, poll interval, max agents.
- CLI status for `gh` and `claude`, with hints and "Check again".
- Repos list with rescan. Orphaned worktrees.

## 13. CLI

`donepm start` (foreground), `donepm stop`, `donepm status`, `donepm open`
(opens browser), `donepm install-service` (writes launchd plist and loads it).

## 14. Configuration

`~/.config/donepm/config.json`. Created on first start with defaults.

```json
{
  "port": 6174,
  "repoRoot": "~/Code",
  "worktreeRoot": "~/.local/share/donepm/worktrees",
  "branchPrefix": "dp/",
  "pollIntervalSeconds": 60,
  "maxConcurrentAgents": 1
}
```

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
- Homebrew tap later. MVP: `pnpm install && pnpm build && node daemon/dist/index.js`.

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
