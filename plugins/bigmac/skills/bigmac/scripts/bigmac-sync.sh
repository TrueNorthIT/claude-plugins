#!/usr/bin/env bash
# bigmac-sync [workspace-name] — sync the current git repo's working tree to
# bigmac for delegated exploration. USER-TRIGGERED by design. See bigmac-sync.ps1.
set -euo pipefail

BOX_HOST="${BIGMAC_SSH:-bigmac@bigmac}"
KEY_FILE="${BIGMAC_KEY:-$HOME/.ssh/bigmac_ed25519}"

ROOT="$(git rev-parse --show-toplevel)" || { echo "not a git repo" >&2; exit 1; }
cd "$ROOT"
NAME="${1:-$(basename "$ROOT")}"
# Sanitize UNCONDITIONALLY — NAME is interpolated into a remote shell command, so a
# crafted value (e.g. ../../.ssh) would write outside the workspace jail on the box.
NAME="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')"
case "$NAME" in ''|*..*|[!a-z0-9]*) echo "invalid workspace name: '$NAME'" >&2; exit 1;; esac

DENY='(^|/)\.env|\.pem$|\.key$|\.pfx$|\.p12$|\.p8$|\.jks$|\.keystore$|(^|/)id_[a-z0-9]+$|(^|/)\.git/|(^|/)\.npmrc$|(^|/)\.netrc$|(^|/)\.git-credentials$|(^|/)credentials$'
# -co lists tracked + untracked-unignored; -Eiv = case-insensitive deny; drop symlinks.
git ls-files -co --exclude-standard | grep -Eiv "$DENY" | while IFS= read -r f; do
  [ -L "$f" ] || printf '%s\n' "$f"
done > /tmp/bigmac-sync-list.$$
COUNT=$(wc -l < /tmp/bigmac-sync-list.$$ | tr -d ' ')
[ "$COUNT" -gt 0 ] || { echo "nothing to sync" >&2; exit 1; }

echo "Syncing $COUNT files from $ROOT -> $BOX_HOST:~/delegate/workspaces/$NAME"
tar -cf - -T /tmp/bigmac-sync-list.$$ | ssh -i "$KEY_FILE" -o BatchMode=yes "$BOX_HOST" \
  "rm -rf ~/delegate/workspaces/$NAME && mkdir -p ~/delegate/workspaces/$NAME && tar -xf - -C ~/delegate/workspaces/$NAME && date -u +%Y-%m-%dT%H:%M:%SZ > ~/delegate/workspaces/$NAME/.bigmac-synced && echo \"SYNCED: \$(find ~/delegate/workspaces/$NAME -type f | wc -l | tr -d ' ') files\""
rm -f /tmp/bigmac-sync-list.$$
echo "Workspace name for explore_start: $NAME"
