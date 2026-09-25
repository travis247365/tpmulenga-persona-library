#!/usr/bin/env bash
# Wire a Claude Design export into the app.
#
# The app carries no literal design value - app/tokens.css is the only file
# that does - so adopting the real system is a file copy plus a check that the
# names actually line up. This script does both and refuses quietly-wrong
# outcomes: a token file that is missing the variables the app reads would
# leave every rule falling back to nothing, which renders as an unstyled page
# rather than an error.
#
#   scripts/ingest-design-system.sh <path-to-export-folder>
set -euo pipefail

SRC="${1:-}"
[ -n "$SRC" ] || { echo "usage: $0 <path-to-export-folder>" >&2; exit 2; }
[ -d "$SRC" ] || { echo "not a directory: $SRC" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_TOKENS="$ROOT/app/tokens.css"

[ -f "$SRC/tokens.css" ] || { echo "no tokens.css in $SRC" >&2; exit 1; }

echo "== export contents =="
for f in README.md tokens.css _ds_manifest.json; do
  [ -e "$SRC/$f" ] && echo "  $f" || echo "  $f  (absent)"
done
for d in foundations components templates chats; do
  [ -d "$SRC/$d" ] && echo "  $d/  ($(find "$SRC/$d" -type f | wc -l | tr -d ' ') files)" \
                   || echo "  $d/  (absent)"
done

# The variables app/index.html actually reads. A design system that names its
# tokens differently is not wrong - it just has to be mapped, and silently
# copying it over would strip the app's styling with no error anywhere.
# Match var(--name) only. A bare --[a-z-]+ pattern also matches the rules of
# dashes inside comment banners, which produced phantom token names.
NEEDED=$(grep -o 'var(--[a-z0-9-]\+)' "$ROOT/app/index.html" \
         | sed 's/^var(//; s/)$//' | sort -u)
MISSING=""
for v in $NEEDED; do
  grep -q -- "$v[[:space:]]*:" "$SRC/tokens.css" || MISSING="$MISSING $v"
done

echo
if [ -n "$MISSING" ]; then
  echo "== the export does not define these, which app/index.html reads =="
  for v in $MISSING; do echo "  $v"; done
  echo
  echo "Not copying. Map these names first, or the app renders unstyled."
  echo "Current values are in $APP_TOKENS."
  exit 1
fi

cp "$SRC/tokens.css" "$APP_TOKENS"
echo "== every token the app reads is defined; copied into app/tokens.css =="
