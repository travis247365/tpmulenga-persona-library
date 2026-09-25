#!/usr/bin/env bash
# Deploy the persona library to fly.io as a PRIVATE app, end to end.
#
#   1. Copy your Fly deploy token to the clipboard (skip if already logged in)
#   2. bash fly-deploy.sh
#
# Takes the token from the clipboard so it never appears on screen or in shell
# history. Creates the app, deploys, then makes it private and VERIFIES that -
# the verification matters, because `fly deploy` allocates public IPs by
# default and a public IP puts the site on the internet no matter what
# fly.toml says.

set -euo pipefail

APP=${APP:-tpmulenga-persona-library}
BRANCH=claude/epic-thompson-hgbsmp
REPO=https://github.com/travis247365/tpmulenga-persona-library
WORKDIR=${WORKDIR:-$HOME/dev/tpmulenga-persona-library}

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

command -v fly >/dev/null || die "flyctl not found. Install: brew install flyctl"

# An old CLI fails in confusing ways and auto-upgrades mid-run, which makes the
# output hard to read. Get the upgrade out of the way first.
fly version upgrade >/dev/null 2>&1 || true

# --- 1. auth ---------------------------------------------------------------
say "Authenticating"
if fly auth whoami >/dev/null 2>&1; then
  echo "already logged in as $(fly auth whoami 2>/dev/null)"
else
  TOKEN=$(pbpaste 2>/dev/null || true)
  case "$TOKEN" in
    FlyV1*|fm2_*)
      # Never echoed, never stored in a file by this script.
      fly auth login --access-token "$TOKEN" >/dev/null 2>&1 \
        || die "the clipboard token was rejected by Fly"
      echo "logged in using the token on your clipboard"
      ;;
    *)
      die "no Fly login and no token on the clipboard.
     Either run:  fly auth login
     or copy a token first:  pbcopy < ~/.config/fly-jobsearch-token"
      ;;
  esac
fi

# --- 2. app ----------------------------------------------------------------
say "App"
if fly apps list 2>/dev/null | awk '{print $1}' | grep -qx "$APP"; then
  echo "'$APP' exists"
else
  # Let Fly's own error stand. It is specific (billing, name collision, org)
  # and more accurate than anything guessed here: the first real failure of
  # this script was an overdue invoice, which no guess would have named.
  fly apps create "$APP" || die "fly apps create failed — see Fly's message above"
fi

# --- 3. source -------------------------------------------------------------
say "Source"
if [ -d "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" fetch origin "$BRANCH" --quiet
  git -C "$WORKDIR" checkout --quiet "$BRANCH"
  git -C "$WORKDIR" pull --quiet origin "$BRANCH"
  echo "updated $WORKDIR"
else
  mkdir -p "$(dirname "$WORKDIR")"
  git clone --quiet --branch "$BRANCH" "$REPO" "$WORKDIR"
  echo "cloned to $WORKDIR"
fi
cd "$WORKDIR"
[ -f fly.toml ] || die "fly.toml missing — wrong branch?"

# --- 4. deploy -------------------------------------------------------------
say "Deploying (remote builder, so local Docker is not required)"
fly deploy --remote-only --app "$APP"

# --- 5. make it private ----------------------------------------------------
say "Removing public IPs"
# Columns: VERSION IP TYPE REGION CREATED AT. Anything not private_v6 is public.
PUBLIC=$(fly ips list -a "$APP" 2>/dev/null | awk 'NR>1 && $3 !~ /private/ && $2 ~ /[.:]/ {print $2}')
if [ -z "$PUBLIC" ]; then
  echo "none allocated"
else
  for ip in $PUBLIC; do
    echo "releasing public IP $ip"
    fly ips release "$ip" -a "$APP"
  done
fi

say "Allocating the private address"
if fly ips list -a "$APP" 2>/dev/null | awk 'NR>1 && $3 ~ /private/' | grep -q .; then
  echo "private IPv6 already allocated"
else
  fly ips allocate-v6 --private -a "$APP"
fi

# --- 6. verify -------------------------------------------------------------
say "Verifying it is actually private"
fly ips list -a "$APP"
STILL=$(fly ips list -a "$APP" 2>/dev/null | awk 'NR>1 && $3 !~ /private/ && $2 ~ /[.:]/ {print $2}')
if [ -n "$STILL" ]; then
  die "PUBLIC IP STILL PRESENT: $STILL
     The app is on the internet. Release it with:  fly ips release <ip> -a $APP"
fi
echo "No public IPs. The app is reachable only over your private network."

cat <<TXT

$(printf '\033[1m')Done.$(printf '\033[0m')

Reach it over WireGuard:
  fly wireguard create        # once per machine
  open http://$APP.flycast/personas/

If you used a clipboard token, clear it now:
  pbcopy </dev/null

Useful later:
  fly logs -a $APP
  fly status -a $APP
  fly tokens list             # revoke with: fly tokens revoke <id>
TXT
