#!/usr/bin/env bash
# Assemble one dated folder holding everything the day produced, plus a zip of
# it for emailing.
#
#   export-bundle.sh [--out DIR] [--since GIT_REF_OR_DATE] [--actions FILE]
#
# Layout, which is the point - one folder, three things, and a manifest:
#
#   JobSearchAGI-YYYY-MM-DD/
#     README.md          what this is and what was done, readable on a phone
#     01-actions/        what the agent did: the sweep report, the git log
#     02-files/          files produced or changed today
#     03-documentation/  the agents, skills and personas as they stood today
#     MANIFEST.txt       every file with its size and SHA-256
#
# The manifest exists so that a bundle opened in six months can be checked
# against what was actually sent, rather than trusted.

set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
OUT=""; SINCE="1 day ago"; ACTIONS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)     OUT=$2; shift 2 ;;
    --since)   SINCE=$2; shift 2 ;;
    --actions) ACTIONS=$2; shift 2 ;;
    *) echo "export-bundle.sh: unknown argument '$1'" >&2; exit 64 ;;
  esac
done

DATE=$(date +%F)
NAME="JobSearchAGI-$DATE"
OUT=${OUT:-${TMPDIR:-/tmp}/$NAME}
rm -rf "$OUT"
mkdir -p "$OUT"/{01-actions,02-files,03-documentation}

cd "$REPO"

# --- 01 actions ------------------------------------------------------------
{
  echo "# Actions — $DATE"
  echo
  echo "## Commits since $SINCE"
  echo
  git log --since="$SINCE" --pretty=format:'- **%s** (%h, %ad)' --date=short || true
  echo
  echo
  echo "## Files changed"
  echo '```'
  git log --since="$SINCE" --name-status --pretty=format:'' | sort -u | sed '/^$/d' || true
  echo '```'
} > "$OUT/01-actions/commits.md"

if [[ -n "$ACTIONS" && -r "$ACTIONS" ]]; then
  cp "$ACTIONS" "$OUT/01-actions/sweep-report.md"
else
  printf '# Sweep report — %s\n\nNo sweep report was supplied for this run.\n' \
    "$DATE" > "$OUT/01-actions/sweep-report.md"
fi

# --- 02 files --------------------------------------------------------------
# Only what actually changed, so the bundle stays about today rather than
# re-sending the whole repository every morning.
changed=$(git log --since="$SINCE" --name-only --pretty=format:'' | sort -u | sed '/^$/d' || true)
count=0
while IFS= read -r f; do
  [[ -n "$f" && -f "$f" ]] || continue
  mkdir -p "$OUT/02-files/$(dirname "$f")"
  cp "$f" "$OUT/02-files/$f"
  count=$((count+1))
done <<< "$changed"
[[ $count -gt 0 ]] || echo "Nothing changed in this window." > "$OUT/02-files/NOTHING-CHANGED.txt"

# --- 03 documentation ------------------------------------------------------
for d in .claude/agents .claude/skills/career-agent personas; do
  [[ -d $d ]] && { mkdir -p "$OUT/03-documentation/$d"; cp -r "$d/." "$OUT/03-documentation/$d/"; }
done
# Never ship the topic: it is the only thing protecting the notifications.
find "$OUT/03-documentation" -name 'ntfy.conf' -delete

# --- README ----------------------------------------------------------------
{
  echo "# JobSearch AGI — $DATE"
  echo
  echo "Everything from today in one folder. Drop it straight into iCloud."
  echo
  echo "| Folder | Holds |"
  echo "|---|---|"
  echo "| \`01-actions/\` | what was done: the inbox sweep report and the commit log |"
  echo "| \`02-files/\` | the $count file(s) produced or changed today |"
  echo "| \`03-documentation/\` | the agents, skills and personas as they stood today |"
  echo
  echo "\`MANIFEST.txt\` lists every file with its SHA-256, so this bundle can be"
  echo "checked later rather than taken on trust."
  echo
  echo "The ntfy topic is deliberately excluded: it is the only thing protecting"
  echo "those notifications, and this bundle travels by email."
} > "$OUT/README.md"

# --- manifest --------------------------------------------------------------
( cd "$OUT" && find . -type f ! -name MANIFEST.txt | sort | while read -r f; do
    printf '%10s  %s  %s\n' "$(stat -c%s "$f")" "$(sha256sum "$f" | cut -c1-16)" "${f#./}"
  done ) > "$OUT/MANIFEST.txt"

# --- zip -------------------------------------------------------------------
# Zip the folder by its actual basename: --out may have renamed it, and
# zipping $NAME instead fails with "Nothing to do!" when the two differ.
BASE=$(basename "$OUT")
ZIP="$(dirname "$OUT")/$BASE.zip"
rm -f "$ZIP"
( cd "$(dirname "$OUT")" && zip -qr "$BASE.zip" "$BASE" )

echo "bundle:  $OUT"
echo "archive: $ZIP"
echo "files:   $(grep -c . "$OUT/MANIFEST.txt")"
echo "size:    $(du -h "$ZIP" | cut -f1)"
