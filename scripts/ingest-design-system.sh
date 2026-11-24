#!/usr/bin/env bash
# Wire a Claude Design export into the app.
#
#   scripts/ingest-design-system.sh <local-dir>
#   scripts/ingest-design-system.sh owner/repo
#   scripts/ingest-design-system.sh owner/repo@branch
#   scripts/ingest-design-system.sh https://github.com/owner/repo.git
#   scripts/ingest-design-system.sh owner/repo --path design/export
#
# The export is usually found on its own, so --path is rarely needed: anything
# with a tokens.css within three levels of the root is located automatically.
#
# The app carries no literal design value - app/tokens.css is the only file
# that does - so adopting the real system is a file copy plus a check that the
# names actually line up. This script does both and refuses quietly-wrong
# outcomes: a token file missing the variables the app reads would leave every
# rule falling back to nothing, which renders as an unstyled page rather than
# an error.
set -euo pipefail

SRC=""; SUBDIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --path) SUBDIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) SRC="$1"; shift ;;
  esac
done
[ -n "$SRC" ] || { echo "usage: $0 <local-dir | owner/repo[@ref] | git-url> [--path subdir]" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_TOKENS="$ROOT/app/tokens.css"
CLONE=""
cleanup() { [ -n "$CLONE" ] && rm -rf "$CLONE"; }
trap cleanup EXIT

# --- resolve the source to a directory on disk ------------------------------
if [ -d "$SRC" ]; then
  DIR="$SRC"
else
  REF=""
  # The subdir is a flag, not a ":suffix". A colon cannot be overloaded here:
  # it already separates the scheme in file:// and https://, and the host in
  # git@host:path, so any ":subdir" rule is ambiguous against a real URL - and
  # got it wrong in both directions before this was a flag.
  #
  # The ref is read from the last path segment only, so the @ in git@host is
  # not mistaken for one.
  case "${SRC##*/}" in *@*) REF="${SRC##*@}"; SRC="${SRC%@*}";; esac
  case "$SRC" in
    # Anything carrying a scheme, plus scp-style git@host:path, is already a
    # URL. Matching only http*|git@* sent file:// and ssh:// to github.com.
    *://*|git@*) URL="$SRC" ;;
    */*)         URL="https://github.com/${SRC}.git" ;;
    *) echo "not a directory, and not owner/repo or a git URL: $SRC" >&2; exit 2 ;;
  esac

  CLONE=$(mktemp -d)
  echo "== cloning $URL${REF:+ @ $REF} =="
  # Shallow: we want the current files, not the history. A private repo needs
  # this session's GitHub credentials, which the git proxy supplies.
  if ! git clone --depth 1 ${REF:+--branch "$REF"} "$URL" "$CLONE/repo" 2>&1 | sed 's/^/  /'; then
    echo "clone failed - if the repo is private, add it to this session first" >&2
    exit 1
  fi
  DIR="$CLONE/repo${SUBDIR:+/$SUBDIR}"
  [ -d "$DIR" ] || { echo "no such path inside the repo: ${SUBDIR:-/}" >&2; exit 1; }
fi

# --- find the export root ---------------------------------------------------
# An export committed to a repo usually sits in a subdirectory rather than at
# the root, so locate tokens.css rather than insisting on a layout.
if [ ! -f "$DIR/tokens.css" ]; then
  FOUND=$(find "$DIR" -maxdepth 3 -name tokens.css -not -path '*/node_modules/*' | head -1 || true)
  [ -n "$FOUND" ] || { echo "no tokens.css anywhere under $DIR" >&2; exit 1; }
  DIR=$(dirname "$FOUND")
  echo "== found the export at ${DIR#"$CLONE/repo/"} =="
fi

echo "== export contents =="
for f in README.md tokens.css _ds_manifest.json; do
  [ -e "$DIR/$f" ] && echo "  $f" || echo "  $f  (absent)"
done
for d in foundations components templates chats; do
  [ -d "$DIR/$d" ] && echo "  $d/  ($(find "$DIR/$d" -type f | wc -l | tr -d ' ') files)" \
                   || echo "  $d/  (absent)"
done

# --- the check that stops a silent success ----------------------------------
# The variables app/index.html actually reads. A design system that names its
# tokens differently is not wrong - it just has to be mapped, and silently
# copying it over would strip the app's styling with no error anywhere.
# Match var(--name) only: a bare --[a-z-]+ pattern also matches the rules of
# dashes inside comment banners, which invented token names.
NEEDED=$(grep -oh 'var(--[a-z0-9-]\+)' "$ROOT/app/index.html" "$ROOT/dashboard/index.html" \
         | sed 's/^var(//; s/)$//' | sort -u)
MISSING=""
for v in $NEEDED; do
  grep -q -- "$v[[:space:]]*:" "$DIR/tokens.css" || MISSING="$MISSING $v"
done

echo
if [ -n "$MISSING" ]; then
  echo "== the export does not define these, which the pages read =="
  for v in $MISSING; do echo "  $v"; done
  echo
  echo "Not copying. Map these names first, or the pages render unstyled."
  echo "Current values are in $APP_TOKENS."
  exit 1
fi

cp "$DIR/tokens.css" "$APP_TOKENS"
echo "== every token the pages read is defined; copied into app/tokens.css =="
echo "   now run: npm run sync:static && npm run build"
