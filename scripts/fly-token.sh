#!/usr/bin/env bash
# Mint a Fly deploy token for the persona library, without it ever appearing
# on screen or in shell history.
#
# Run on your Mac:   bash fly-token.sh
#
# Creates the app if it does not exist, mints a token scoped to THAT APP'S
# DEPLOYS ONLY (not your account), and writes it to a 0600 file. It prints the
# file path and nothing else - the token is never echoed, so it does not end up
# in scrollback, in ~/.zsh_history, or in anything you paste into a chat.

set -euo pipefail

APP=${1:-tpmulenga-persona-library}
OUT="$HOME/.config/fly-jobsearch-token"

command -v fly >/dev/null || { echo "flyctl not found. Install: brew install flyctl"; exit 1; }
fly auth whoami >/dev/null 2>&1 || { echo "Not logged in. Run: fly auth login"; exit 1; }

if fly apps list 2>/dev/null | awk '{print $1}' | grep -qx "$APP"; then
  echo "app '$APP' already exists"
else
  echo "creating app '$APP' (no IPs allocated, so it stays private)..."
  fly apps create "$APP"
fi

mkdir -p "$(dirname "$OUT")"
umask 077                      # the file is created 0600, never briefly world-readable

# Capture straight to the file. The token is never assigned to a shell variable
# and never written to stdout, so it cannot be scrolled back to or echoed.
fly tokens create deploy -a "$APP" --name "jobsearch-agi-deploy" > "$OUT"
chmod 600 "$OUT"

if [ ! -s "$OUT" ]; then
  echo "token file is empty - something went wrong; nothing was saved"
  rm -f "$OUT"
  exit 1
fi

cat <<TXT

Done. Token saved to:
  $OUT

It is scoped to deploys of '$APP' only - it cannot touch the rest of your Fly
account, and you can revoke it any time with:
  fly tokens list
  fly tokens revoke <id>

To let the agent deploy, copy the file's contents into an environment secret
named FLY_API_TOKEN, using the environment settings panel - not a chat message:

  pbcopy < $OUT        # now in your clipboard, still not on screen

Then paste into: cloud environment menu -> Edit -> environment variables.
Clear your clipboard afterwards with:  pbcopy </dev/null

Or skip all that and deploy from here yourself:
  git clone -b claude/epic-thompson-hgbsmp https://github.com/travis247365/tpmulenga-persona-library
  cd tpmulenga-persona-library
  fly deploy
  fly ips list                 # must be EMPTY - release anything listed
  fly ips allocate-v6 --private
TXT
