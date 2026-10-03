# donePM

A local daemon with a web UI that collects your work from GitHub (later Jira), shows it on a
board, runs a coding agent in a git worktree per item, and lets you approve every pull request,
comment or merge as a draft before it leaves your machine.

Status: pre-MVP. Nothing runs yet.

## Development

### Requirements

- Node 22+
- pnpm (workspaces)
- `gh` CLI logged in (`gh auth login`)
- Optionally: `claude` CLI logged in (`claude auth login`) for live agent tests

### Installation & Build

```bash
pnpm install
pnpm build          # builds core, daemon, and web UI
```

### Running

**Built daemon:**
```bash
node packages/daemon/dist/index.js
# Then open http://localhost:6174 (binds to 127.0.0.1 only)
```

**Development mode (with hot reload):**
```bash
pnpm dev
# Daemon watches for changes on :6174
# Vite dev server on http://localhost:5173 (with hot reload)
# Open http://localhost:5173 in dev mode
```

### Configuration

On first start, the daemon creates `~/.config/donepm/config.json` with:
- `port` (default 6174)
- `repoRoot` (default `~/Code`)
- `worktreeRoot`
- `branchPrefix` (default `dp/`)
- `pollIntervalSeconds` (default 60)
- `maxConcurrentAgents` (default 1)

Settings are also editable in the UI under Settings.

To use a separate config during development, set `DONEPM_HOME`:
```bash
DONEPM_HOME=/tmp/donepm-dev node packages/daemon/dist/index.js
```

### Testing

```bash
pnpm test                   # all packages
pnpm -F core test          # one package
DONEPM_LIVE=1 pnpm test    # includes live agent tests (costs money)
```

### Troubleshooting

If port 6174 is busy, a running daemon instance is likely; stop it first.

## Resources

- `docs/intent.md` – why this exists and what it is not
- `docs/spec.md` – the MVP, in detail
- `docs/decisions.md` – decisions already made, with reasons
- `playbooks/implement.md` – the default playbook
- `CLAUDE.md` – rules for coding agents working on this repository
