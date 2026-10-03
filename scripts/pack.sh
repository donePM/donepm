#!/usr/bin/env bash
# Pack donePM into dist-release/donepm-<version>.tar.gz: the cli with its production
# dependencies (daemon with the built web UI, core), as the Homebrew formula installs it.
set -euo pipefail

version="${1:?usage: scripts/pack.sh <version>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dist-release"
stage="$out/donepm-$version"

cd "$root"
rm -rf "$stage"
mkdir -p "$out"
pnpm build
pnpm --filter @donepm/cli deploy --prod "$stage"
# deploy leaves pnpm's workspace files behind; the installed package needs neither.
rm -f "$stage/pnpm-lock.yaml" "$stage/pnpm-workspace.yaml"
# tsc writes the bin without the executable bit; Homebrew's wrapper execs it directly.
chmod 0755 "$stage/dist/main.js"
tar -czf "$out/donepm-$version.tar.gz" -C "$out" "donepm-$version"
echo "$out/donepm-$version.tar.gz"
