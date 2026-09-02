#!/usr/bin/env bash
# vendor-cli.sh — cross-compile the retraction-checker CLI to
# bin/retraction-checker-pp-cli-linux (linux/amd64), which the Docker image
# copies and runs.
#
# This repo had no vendoring script until 2026-09-02. The Dockerfile expected
# bin/retraction-checker-pp-cli-linux with nothing recording how to produce it,
# and the binary sat at its 2026-07-12 build for seven weeks. The CLI's own
# logic has not changed in that time — the only upstream commit touching it is
# the one that added it to main — so what a rebuild brings is the newer Go
# toolchain and its stdlib fixes, not new behaviour.
#
# The default source is the monorepo under ~/printing-press-library, NOT the
# Desktop copy: there are two clones on this machine and they sit on different
# branches. Vendoring from a feature branch ships whatever that branch happens
# to hold, and the result looks identical to a correct build.
#
# cmd/ holds two binaries, the CLI and an MCP server. Only the CLI is built
# here; the Dockerfile copies only that one.
#
# USAGE (from the retractis repo, Git Bash):
#   ./vendor-cli.sh
#   ./vendor-cli.sh "/c/Users/LACI/printing-press-library/library/other/retraction-checker"
set -euo pipefail
CLI_SRC="${1:-/c/Users/LACI/printing-press-library/library/other/retraction-checker}"
OUT="bin/retraction-checker-pp-cli-linux"
if [ ! -f "$CLI_SRC/go.mod" ] || [ ! -d "$CLI_SRC/cmd" ]; then
  echo "ERROR: CLI source not found at: $CLI_SRC" >&2
  exit 1
fi
echo "Vendoring from: $CLI_SRC"
( cd "$CLI_SRC" && git rev-parse --abbrev-ref HEAD && git log --oneline -1 -- . )
rm -rf cli-src && mkdir -p cli-src
# go.sum only exists when the CLI has external dependencies.
cp "$CLI_SRC/go.mod" cli-src/
[ -f "$CLI_SRC/go.sum" ] && cp "$CLI_SRC/go.sum" cli-src/ || true
cp -r "$CLI_SRC/cmd" "$CLI_SRC/internal" cli-src/
echo "Cross-compiling -> $OUT"
mkdir -p bin
( cd cli-src && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o "../$OUT" ./cmd/retraction-checker-pp-cli )
# `file` is not present in every Git Bash; a missing one must not kill the
# script under set -e after a successful build.
command -v file >/dev/null && file "$OUT" || true
ls -la "$OUT"