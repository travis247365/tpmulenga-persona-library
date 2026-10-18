#!/usr/bin/env bash
#
# Take the job-pack pipeline live, in one command.
#
#   bash scripts/go-live.sh
#
# This exists because a list of commands pasted into a terminal is a bad
# handover. zsh runs each line as it arrives, so when line one fails the rest
# run anyway, against a tree that was never updated - which is exactly how the
# last attempt ended with a secret being pushed from stale code.
#
# So: every step states its precondition, checks it, and STOPS if it is not
# met. Nothing here is destructive, nothing runs twice to any ill effect, and
# it is safe to re-run after fixing whatever it stopped on.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="claude/epic-thompson-hgbsmp"
WORKER="jobsearch-ingest"

step()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()    { printf '   \033[32m%s\033[0m\n' "$*"; }
warn()  { printf '   \033[33m%s\033[0m\n' "$*"; }
note()  { printf '   %s\n' "$*"; }
stop()  { printf '   \033[31m%s\033[0m\n' "$*"; printf '\n   Fix that, then run this again.\n\n'; exit 1; }
ask()   { printf '   %s [y/N] ' "$1"; read -r a; case "$a" in [Yy]*) return 0 ;; *) return 1 ;; esac; }

# ---------------------------------------------------------------------------
step "1/6  Is the working tree ready to update?"
DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
  warn "You have uncommitted changes:"
  printf '%s\n' "$DIRTY" | sed 's/^/      /'
  note ""
  note "git pull refuses to overwrite these. Here is what differs:"
  git --no-pager diff --stat | sed 's/^/      /'
  note ""
  if ask "Stash them, pull, then put them back?"; then
    # No path list: porcelain prints renames as "R old -> new", and splitting
    # that on whitespace feeds git a filename that does not exist.
    git stash push --message "go-live.sh $(date -u +%FT%TZ)" >/dev/null
    ok "stashed"
    STASHED=1
  else
    stop "Stopping so you can deal with them yourself (git diff, git checkout --, or git commit)."
  fi
else
  ok "clean"
  STASHED=0
fi

# ---------------------------------------------------------------------------
step "2/6  Latest code"
git fetch --quiet origin "$BRANCH" || stop "could not reach GitHub."
BEFORE=$(git rev-parse HEAD)
git merge --ff-only "origin/$BRANCH" >/dev/null 2>&1 \
  || stop "cannot fast-forward - your branch has diverged. Run: git log --oneline HEAD..origin/$BRANCH"
AFTER=$(git rev-parse HEAD)
[ "$BEFORE" = "$AFTER" ] && ok "already current ($(git rev-parse --short HEAD))" \
                         || ok "updated $(git rev-parse --short "$BEFORE") -> $(git rev-parse --short "$AFTER")"

if [ "${STASHED:-0}" = "1" ]; then
  if git stash pop >/dev/null 2>&1; then
    ok "your local changes are back"
  else
    warn "your changes conflict with the update - they are still in: git stash list"
    stop "Resolve with: git checkout --theirs/--ours, or git stash pop and fix by hand."
  fi
fi

# ---------------------------------------------------------------------------
step "3/6  Do the tests pass?"
command -v node >/dev/null 2>&1 || stop "node is not installed."
if node --test worker/test/worker.test.js worker/test/reply.test.js >/tmp/.golive.$$ 2>&1; then
  ok "$(grep -E '^# pass' /tmp/.golive.$$ | head -1 | tr -s ' ') / $(grep -E '^# tests' /tmp/.golive.$$ | head -1 | tr -s ' ')"
  rm -f /tmp/.golive.$$
else
  sed 's/^/      /' /tmp/.golive.$$ | grep -A6 "not ok" | head -30
  rm -f /tmp/.golive.$$
  stop "tests are red - deploying this would ship a broken pipeline."
fi

# ---------------------------------------------------------------------------
step "4/6  Cloudflare login"
WR="npx --yes wrangler@4"
WHO=$($WR whoami 2>&1 || true)
printf '%s' "$WHO" | grep -qiE 'account id|you are logged in' \
  || { printf '%s\n' "$WHO" | sed 's/^/      /' | head -8
       stop "not logged in. Run: npx wrangler login"; }
ok "logged in"
# The permission that actually matters here is Workers Scripts: Edit. Deploying
# and writing a secret are different API calls, and a login can carry one
# without the other - which is precisely what bit us last time, silently, after
# the deploy had already succeeded.
printf '%s\n' "$WHO" | grep -iE 'scope|permission' | sed 's/^/      /' | head -20 || true

# ---------------------------------------------------------------------------
step "5/6  The Anthropic key on the worker"
if $WR secret list --name "$WORKER" 2>/dev/null | grep -q ANTHROPIC_API_KEY; then
  ok "already set"
  if ask "Replace it?"; then bash scripts/set-anthropic-key.sh || stop "key step failed."; fi
else
  warn "not set - packs would go out unranked."
  bash scripts/set-anthropic-key.sh || stop "key step failed."
fi

# ---------------------------------------------------------------------------
step "6/6  Deploy"
: "${REPLY_TO:=}"
if [ -z "$REPLY_TO" ]; then
  note "REPLY_TO decides where packs are mailed. Without it the send_email"
  note "binding is stripped and the worker cannot send at all."
  printf '   Address to mail packs to (blank to deploy without sending): '
  read -r REPLY_TO
fi
if [ -n "$REPLY_TO" ]; then
  note "That address MUST already be verified in Cloudflare:"
  note "  Email -> Email Routing -> Destination addresses"
  note "If it is not, this deploy will fail - that is the guarantee working."
  ask "Is $REPLY_TO verified?" || stop "Verify it first, then run this again."
fi

REPLY_TO="$REPLY_TO" INGEST_DOMAIN="${INGEST_DOMAIN:-jobs.travispaulconsulting.co}" \
  bash scripts/deploy-all.sh || stop "deploy failed - see above."

step "Done"
note "What the pipeline did:   bash scripts/check-reply.sh"
note "Turn packs on for a feed: bash scripts/enable-replies.sh <token> $REPLY_TO"
printf '\n'
