<img src="packages/web/public/icons/icon-128x128.png" alt="" width="64" height="64">

# donePM

A local daemon with a web UI that collects your work from GitHub (later Jira), shows it on a
board, runs a coding agent in a git worktree per item, and lets you approve every pull request,
comment or merge as a draft before it leaves your machine.

Status: MVP, macOS only.

## Install

Requirements: macOS, `git`, the `gh` CLI logged in (`gh auth login`) and the `claude` CLI
(Claude Code) logged in.

```bash
brew install donepm/tap/donepm
donepm install-service    # start now and at every login
```

Homebrew brings Node. After `brew upgrade donepm`, run `donepm install-service` again: it restarts
the daemon on the new version.

From source instead (Node 22+ and pnpm):

```bash
git clone https://github.com/donePM/donepm.git && cd donepm
pnpm install
pnpm build
alias donepm="node $PWD/packages/cli/dist/main.js"   # put this in ~/.zshrc
```

### First start

```bash
donepm start              # foreground; Ctrl-C stops it
donepm open               # the board at http://127.0.0.1:6174
```

To keep donePM running in the background and start it at login:

```bash
donepm install-service    # writes ~/Library/LaunchAgents/com.donepm.daemon.plist and loads it
donepm status             # running? which version, gh and claude ready?
donepm stop               # stops it until the next login (or the next install-service)
donepm uninstall-service  # removes the launchd job
```

launchd restarts the daemon after a crash, not after `donepm stop`. The plist records the
current `node` binary, the daemon's path and your `PATH` (so the daemon finds `gh`, `git` and
`claude`). With Homebrew these are stable `opt` paths. From source, run `donepm install-service`
again after moving the checkout, upgrading Node or changing where those tools live. After `git pull` and `pnpm build`, `donepm install-service`
also restarts the daemon on the new code.

### Where things live

| What | Where |
|---|---|
| Config | `~/.config/donepm/config.json` (created on first start) |
| Playbooks | `~/.config/donepm/playbooks/` (`implement.md` is written on first start), `<repo>/.donepm/playbooks/` |
| Database | `~/.local/share/donepm/donepm.db` |
| Worktrees | `~/.local/share/donepm/worktrees/<owner-repo>/<branch>` |
| Logs (service) | `~/Library/Logs/donepm/daemon.log`, `daemon.err.log` |
| launchd job | `~/Library/LaunchAgents/com.donepm.daemon.plist` |

Worktrees are not removed automatically: remove them from a done or failed item, or from
Settings → Orphaned worktrees. Turn on "Remove the worktree once its PR is merged" in
Settings → General to have donePM remove a clean worktree after its PR is merged; the branch stays.

## Development

### Requirements

- Node 22+
- pnpm (workspaces)
- `gh` CLI logged in (`gh auth login`)
- `claude` CLI (Claude Code) logged in (`claude auth login`), needed to run agents

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

Vite proxies `/api` and `/ws` to the daemon. The daemon's dev script sets
`DONEPM_DEV_ORIGIN=http://localhost:5173` so it accepts requests from the Vite origin.
`pnpm dev` builds `core` once, then watches `core`, `daemon` and `web` together.

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

Config and data then live under `$DONEPM_HOME/.config/donepm/` and `$DONEPM_HOME/.local/share/donepm/`.
Point it at your clones by setting `repoRoot` in that config to an absolute path, e.g.
`{"repoRoot": "/Users/you/workspace"}`. A leading `~` expands to `DONEPM_HOME`, not your real home.

### Starting an agent without the UI

```bash
curl -X POST http://127.0.0.1:6174/api/items/<id>/start      # worktree, setup, then claude
curl http://127.0.0.1:6174/api/items/<id>/transcript         # stored transcript
curl -X POST -H 'content-type: application/json' \
  -d '{"behavior":"allow"}' http://127.0.0.1:6174/api/asks/<ask-id>/answer
```

Worktrees go to `worktreeRoot/<owner-repo>/<branch>`. A repository can add `.donepm/setup.yml`
(`copy:` files from the main clone, `run:` commands in the worktree). Playbooks live in
`~/.config/donepm/playbooks/` (the default `implement.md` is written there on first start) and
`<repo>/.donepm/playbooks/`.

### Testing

```bash
pnpm test                   # all packages
pnpm -F core test          # one package
DONEPM_LIVE=1 pnpm test    # includes live agent tests (costs money)
```

### Releasing

Push a tag `v<version>` on `main`. `.github/workflows/release.yml` sets that version in every
package, builds, tests, packs the tarball with `scripts/pack.sh`, publishes a GitHub Release and
updates `Formula/donepm.rb` in `donePM/homebrew-tap` from `packaging/homebrew/donepm.rb.tmpl`.
It needs the secret `HOMEBREW_TAP_TOKEN` (fine-grained, contents write on `homebrew-tap` only).

```bash
scripts/pack.sh 0.0.0       # the same tarball locally, in dist-release/
```

### Troubleshooting

`pnpm dev` needs both ports free:

- **6174** (daemon): the daemon exits with "port 6174 is already in use". Stop the other
  donePM first, e.g. a `node packages/daemon/dist/index.js` in another terminal.
- **5173** (Vite): Vite exits with "Port 5173 is already in use", usually another Vite dev
  server. Stop it.

Check who holds a port with `lsof -iTCP:6174 -sTCP:LISTEN`.

## Resources

- `docs/intent.md` – why this exists and what it is not
- `docs/spec.md` – the MVP, in detail
- `docs/decisions.md` – decisions already made, with reasons
- `packages/daemon/playbooks/implement.md` – the default playbook, copied to `~/.config/donepm/playbooks/` on first start
- `CLAUDE.md` – rules for coding agents working on this repository
