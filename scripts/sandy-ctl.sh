#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="cn.sandy.bot"
PLIST_SRC="$ROOT/deploy/cn.sandy.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
SERVICE="${DOMAIN}/${LABEL}"

mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"

cmd="${1:-status}"

is_loaded() {
  launchctl print "$SERVICE" >/dev/null 2>&1
}

unload() {
  if is_loaded; then
    launchctl bootout "$DOMAIN" "$PLIST_DST" >/dev/null 2>&1 || true
  fi
}

load() {
  cp "$PLIST_SRC" "$PLIST_DST"
  launchctl bootstrap "$DOMAIN" "$PLIST_DST"
  launchctl enable "$SERVICE" >/dev/null 2>&1 || true
}

case "$cmd" in
  install|start)
    pkill -f 'feishu-cursor-bot/node_modules/.bin/tsx src/cli.ts' 2>/dev/null || true
    pkill -f 'feishu-cursor-bot/node_modules/tsx/dist/cli.mjs src/cli.ts' 2>/dev/null || true
    sleep 1
    unload
    load
    echo "Sandy launchd installed and started ($SERVICE)"
    ;;
  stop)
    unload
    echo "Sandy stopped"
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  uninstall)
    unload
    rm -f "$PLIST_DST"
    echo "Sandy launchd uninstalled"
    ;;
  status)
    if is_loaded; then
      launchctl print "$SERVICE" | awk '
        /state =/ || /pid =/ || /last exit code/ { print }
      '
    else
      echo "not loaded"
      exit 1
    fi
    ;;
  logs)
    touch "$ROOT/logs/sandy.out.log" "$ROOT/logs/sandy.err.log"
    tail -n 80 -F "$ROOT/logs/sandy.out.log" "$ROOT/logs/sandy.err.log"
    ;;
  *)
    echo "Usage: $0 {install|start|stop|restart|uninstall|status|logs}"
    exit 1
    ;;
esac
