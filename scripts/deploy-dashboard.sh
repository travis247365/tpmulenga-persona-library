#!/usr/bin/env bash
# Deploy the console to its own subdomain of the persona library.
#
#   bash deploy-dashboard.sh          (Cloudflare token on the clipboard)
#
# Cloudflare Pages gives every branch its own alias, so deploying the dashboard
# folder as the ROOT of a branch named "dashboard" produces exactly that:
#
#   https://dashboard.job-search-agentic-ai.pages.dev/
#
# Deploying the folder itself (rather than dist/public) keeps the console at the
# root of that subdomain instead of one level down at /dashboard/.

set -euo pipefail
PROJECT=${PROJECT:-job-search-agentic-ai}
WORKDIR=${WORKDIR:-$HOME/dev/tpmulenga-persona-library}

# Was: demand a token off the clipboard and exit without one. That made this
# the only script still forcing a token to exist, which is worth nothing when
# a browser login does the same job with no secret to keep.
. "$(dirname "$0")/lib-cf-auth.sh"
echo "auth $AUTH"

cd "$WORKDIR"
git fetch --quiet origin claude/epic-thompson-hgbsmp
git checkout --quiet claude/epic-thompson-hgbsmp
git pull --quiet origin claude/epic-thompson-hgbsmp

npx --yes wrangler@4 pages deploy dashboard \
    --project-name "$PROJECT" --branch dashboard --commit-dirty=true

cat <<TXT

Console:  https://dashboard.$PROJECT.pages.dev/

The Access policy on *.$PROJECT.pages.dev covers this subdomain too - which is
exactly why the wildcard matters. Verify before sharing: an unprotected console
lists which companies have not replied to you.
TXT
