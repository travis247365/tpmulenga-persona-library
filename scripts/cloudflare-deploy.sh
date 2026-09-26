#!/usr/bin/env bash
# Deploy the persona library to Cloudflare Pages, then CHECK that Cloudflare
# Access is actually protecting it.
#
#   1. Copy your Cloudflare API token to the clipboard
#   2. bash cloudflare-deploy.sh
#
# Pages is free and Access is free for small teams, so this is the one
# free-and-private combination. But Pages alone is PUBLIC: Access is a separate
# thing you configure in the Zero Trust dashboard, and until you do, the site is
# on the internet. This script deploys, then probes the live URL and tells you
# which of the two states you are in rather than assuming the good one.
#
# Token needs: Account > Cloudflare Pages > Edit
#   https://dash.cloudflare.com/profile/api-tokens

set -euo pipefail

PROJECT=${PROJECT:-tpm-persona-library}
BRANCH=claude/epic-thompson-hgbsmp
REPO=https://github.com/travis247365/tpmulenga-persona-library
WORKDIR=${WORKDIR:-$HOME/dev/tpmulenga-persona-library}

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$1"; }
die()  { printf '\n\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

command -v npx >/dev/null || die "node/npx not found. Install: brew install node"

# --- token -----------------------------------------------------------------
say "Token"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "using CLOUDFLARE_API_TOKEN from the environment"
else
  TOKEN=$(pbpaste 2>/dev/null || true)
  # Cloudflare tokens are 40 chars of [A-Za-z0-9_-]; check shape, never print it.
  if printf '%s' "$TOKEN" | grep -qE '^[A-Za-z0-9_-]{36,}$'; then
    export CLOUDFLARE_API_TOKEN="$TOKEN"
    echo "using the token on your clipboard"
  else
    die "no token. Create one with 'Account > Cloudflare Pages > Edit' at
     https://dash.cloudflare.com/profile/api-tokens
     then copy it and re-run."
  fi
fi

# --- account id ------------------------------------------------------------
# A token scoped to "Cloudflare Pages: Edit" cannot LIST accounts - that needs
# "Account Settings: Read". Rather than widen the token, name the account
# explicitly. Checked here, before the build, so a missing value costs seconds
# rather than a full install-and-build cycle.
say "Account"
ID_FILE="$HOME/.config/cloudflare-account-id"
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "using CLOUDFLARE_ACCOUNT_ID from the environment"
elif [ -r "$ID_FILE" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(tr -d '[:space:]' < "$ID_FILE")
  export CLOUDFLARE_ACCOUNT_ID
  echo "using the account id saved in $ID_FILE"
else
  cat <<'TXT'
Your Cloudflare account id is needed. Find it either way:

  * open https://dash.cloudflare.com - the id is in the URL:
      https://dash.cloudflare.com/<THIS BIT>/...
  * or: dashboard -> Workers & Pages -> "Account ID" in the right sidebar

It is 32 hex characters. It is an identifier, not a secret.
TXT
  printf 'Account id: '
  read -r ACCT
  ACCT=$(printf '%s' "$ACCT" | tr -d '[:space:]')
  printf '%s' "$ACCT" | grep -qE '^[0-9a-f]{32}$' \
    || die "that does not look like an account id (expected 32 hex characters)"
  mkdir -p "$(dirname "$ID_FILE")"
  printf '%s\n' "$ACCT" > "$ID_FILE"
  export CLOUDFLARE_ACCOUNT_ID="$ACCT"
  echo "saved to $ID_FILE so this is asked only once"
fi

# --- source and build ------------------------------------------------------
say "Source"
if [ -d "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" fetch --quiet origin "$BRANCH"
  git -C "$WORKDIR" checkout --quiet "$BRANCH"
  git -C "$WORKDIR" pull --quiet origin "$BRANCH"
else
  mkdir -p "$(dirname "$WORKDIR")"
  git clone --quiet --branch "$BRANCH" "$REPO" "$WORKDIR"
fi
cd "$WORKDIR"

say "Building"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm run build
[ -d dist/public ] || die "dist/public missing after build"

# --- project ---------------------------------------------------------------
# `pages deploy` offers to create a missing project, which needs prompts it
# cannot show when its output is piped. So create it explicitly, with the
# branch named, and let "already exists" pass.
say "Pages project"
CREATE_LOG=$(mktemp)
if npx --yes wrangler@4 pages project create "$PROJECT" \
      --production-branch main >"$CREATE_LOG" 2>&1; then
  echo "created project '$PROJECT'"
elif grep -qiE 'already (exists|have)|duplicate' "$CREATE_LOG"; then
  echo "project '$PROJECT' already exists"
else
  cat "$CREATE_LOG" >&2
  die "could not create the Pages project — see above"
fi
rm -f "$CREATE_LOG"

# --- deploy ----------------------------------------------------------------
say "Deploying to Cloudflare Pages"
# Write to a log AND the terminal, but keep the pipeline out of a command
# substitution: wrapping wrangler in $(...) hid its progress and made it treat
# the run as non-interactive.
LOG=$(mktemp)
npx --yes wrangler@4 pages deploy dist/public \
    --project-name "$PROJECT" --branch main --commit-dirty=true 2>&1 | tee "$LOG"
# `|| true`: under `set -euo pipefail` a grep that matches nothing exits 1 and
# takes the script with it - before this line's own error message, before the
# log is cleaned up, and before the Access probe that is the whole point.
URL=$(grep -oE 'https://[a-z0-9.-]*\.pages\.dev' "$LOG" | tail -1 || true)
rm -f "$LOG"
[ -n "$URL" ] || die "deploy produced no *.pages.dev URL — see wrangler's output above"

# --- the part that actually decides privacy --------------------------------
say "Checking whether Access is protecting it"
echo "probing $URL"
# One curl, both values, and the exit status handled separately. Appending a
# fallback with `|| echo 000` concatenated onto curl's own "000" and produced
# "000000", which matched no branch below. A fresh Pages URL also takes a few
# seconds to answer, so retry rather than calling the first miss inconclusive.
CODE=000; CHAIN=""
for attempt in 1 2 3 4 5; do
  if out=$(curl -s -o /dev/null -w '%{http_code} %{url_effective}' \
             -L --max-time 20 "$URL" 2>/dev/null); then
    CODE=${out%% *}
    CHAIN=${out#* }
    [ "$CODE" != "000" ] && break
  fi
  echo "  no answer yet (attempt $attempt/5) — waiting 10s for propagation"
  sleep 10
done
echo "  HTTP $CODE"

if printf '%s' "$CHAIN" | grep -q 'cloudflareaccess\.com'; then
  printf '\n\033[32mPROTECTED.\033[0m Requests are redirected to Cloudflare Access.\n'
  echo "  $URL  ->  $CHAIN"
elif [ "$CODE" = "200" ]; then
  warn "PUBLIC. The site returned 200 with no Access redirect — anyone with the
URL can read it right now. Personas are not secret, but you asked for private,
so finish the second half:

  1. https://one.dash.cloudflare.com  ->  Access  ->  Applications
  2. Add an application  ->  Self-hosted
  3. Application domain:  ${URL#https://}
  4. Add a policy:  Action = Allow,  Include = Emails = travis.mulenga@gmail.com
  5. Save, then re-run this script — it will re-probe and confirm.

Until then treat the URL as public."
  exit 2
else
  warn "Inconclusive: HTTP $CODE. Cloudflare may still be propagating — wait a
minute and re-run. Do not assume it is protected."
  exit 2
fi

cat <<TXT

Deployed and protected.
  Library:  $URL/personas/

If you used a clipboard token, clear it:  pbcopy </dev/null
Revoke it any time at https://dash.cloudflare.com/profile/api-tokens
TXT
