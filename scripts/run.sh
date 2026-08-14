#!/usr/bin/env bash
# launchd entrypoint — keep PATH similar to an interactive login shell.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.bin:${PATH:-}"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "[run] missing $ROOT/.env — copy from .env.example first" >&2
  exit 1
fi

exec npm start
