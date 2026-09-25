#!/usr/bin/env bash
# Deploy the console to its own subdomain of the persona library.
#
#   bash deploy-dashboard.sh          (Cloudflare token on the clipboard)
#
# Cloudflare Pages gives every branch its own alias, so deploying the dashboard
# folder as the ROOT of a branch named "dashboard" produces exactly that:
#
#   https://dashboard.tpm-persona-library.pages.dev/
#
# Deploying the folder itself (rather than dist/public) keeps the console at the
# root of that subdomain instead of one level down at /dashboard/.

set -euo pipefail
PROJECT=${PROJECT:-tpm-persona-library}
WORKDIR=${WORKDIR:-$HOME/dev/tpmulenga-persona-library}

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || export CLOUDFLARE_API_TOKEN=$(pbpaste 2>/dev/null || true)
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || \
  CLOUDFLARE_ACCOUNT_ID=$(tr -d '[:space:]' < "$HOME/.config/cloudflare-account-id" 2>/dev/null || true)
export CLOUDFLARE_ACCOUNT_ID
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "no token on the clipboard"; exit 1; }
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "no account id saved"; exit 1; }

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
