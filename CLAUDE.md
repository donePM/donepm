# donePM

A local daemon with a web UI that collects work (GitHub issues first), shows it on a board, runs a
coding agent in a git worktree per item, and lets the user approve every outward action as a draft.
Read `docs/intent.md` for the why and `docs/spec.md` for what to build. `docs/decisions.md` lists
decisions already made with their reasons; do not reopen them without asking.

## Stack

- Node 22+, TypeScript (strict), pnpm workspaces.
- `packages/core`: domain only. Items, events, drafts, playbooks, state machine. No I/O, no
  framework imports. Everything here has tests.
- `packages/daemon`: Fastify, `ws`, SQLite (`node:sqlite`), git, `gh` adapter, agent runner,
  MCP server, launchd. Imports `core`.
- `packages/web`: Vue 3 + Vite. Built into `daemon` at build time.
- `packages/cli`: thin CLI over the daemon's HTTP API.
- Default port 6174. All HTTP binds to 127.0.0.1 only.

## Rules

- **Drafts are the only way out.** No code path in the agent's reach may call `gh`, `git push`,
  or any network API. Outward effects go through MCP `draft_*` tools, and the daemon executes
  them only after the user approves. If you find a shortcut, it is a bug.
- **Agents never see credentials.** The daemon calls `gh`. The agent gets a filtered `PATH` and
  deny rules. Do not add token handling to the agent side.
- **Append-only events.** Rows in `events` are never updated. They are deleted only together with
  their whole item, by the retention purge of archived items (D37).
- **State transitions live in `core`** as pure functions that throw on invalid transitions. The
  daemon calls them; it does not decide on its own.
- **Never fail on unknown stream-json events.** Store the raw line, decode what is known, carry on.
- **No worktree is removed automatically** unless the user turned on `removeWorktreeOnMerge`, and
  then only after the PR is merged and the worktree is clean. Otherwise only the user's button does
  that.
- Keep files grouped by subject, not by layer ("services", "utils"). Prefer small files with one
  responsibility.

## Commands

```
pnpm install
pnpm build          build web, then compile all packages
pnpm test           run all tests (vitest)
pnpm -F core test   one package
pnpm dev            daemon in watch mode + vite dev server
```

## Testing

- `core`: unit tests for every transition, parser and naming function.
- `daemon`: parser tests against recorded stream-json fixtures in `packages/daemon/fixtures/`.
  Runner tests use a fake process factory, never a real `claude`.
- `gh` adapter: tests against recorded JSON output.
- Live agent test only behind `DONEPM_LIVE=1`. It costs money. Not in CI.
- Never assert wall-clock durations. Assert what happened.

## Reference

Bloom (`spatie/bloom`) solved the same process and protocol problems in Swift. Its
`docs/PROTOCOL.md` (Claude Code stream-json) and `docs/BRIDGE.md` (MCP stdio shim over a unix
socket) are the measured ground truth we build on. When the protocol behaves unexpectedly, check
there first.

## Working on issues

Issues are ordered by the build order in `docs/spec.md` §18. Take the lowest open number unless
told otherwise. Each issue names the spec sections it covers. Finish with tests passing and a PR.
