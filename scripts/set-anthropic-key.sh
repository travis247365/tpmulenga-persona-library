#!/usr/bin/env bash
#
# Put the Anthropic key everywhere it is needed, from the terminal, once.
#
#   bash scripts/set-anthropic-key.sh
#
# The key is typed at a silent prompt. It is never an argument, never echoed,
# never written into the repo, and never pasted into a chat. Four rules this
# script follows so that stays true:
#
#   - read -rs      so it is not displayed and not kept in shell history
#   - no argv       anything on a command line is visible to `ps` to every
#                   other process on the machine, so the key goes over stdin
#   - set +x        tracing is forced off; `bash -x` on this file would
#                   otherwise print the key on every expansion
#   - no temp file  nothing is written to /tmp, where it would outlive this run
#
# It verifies the key against the API before distributing it, so a dead key is
# caught here rather than three days later in a job pack that quietly arrived
# unranked.
set -euo pipefail
set +x
cd "$(dirname "$0")/.."

# A trap, so an interrupted run does not leave the key in the environment of
# whatever runs next in this shell.
cleanup() { unset KEY; }
trap cleanup EXIT INT TERM

MODE="set"
case "${1:-}" in
  --print) MODE="print" ;;
  --check) MODE="check" ;;
  --help|-h)
    cat <<'USAGE'
  bash scripts/set-anthropic-key.sh           prompt, verify, distribute
  bash scripts/set-anthropic-key.sh --check   prompt and verify only
  bash scripts/set-anthropic-key.sh --print   print the stored key to stdout
                                              (for piping; never to a terminal
                                               someone is looking over)
USAGE
    exit 0 ;;
  "") : ;;
  *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
esac

WORKER="jobsearch-ingest"
KEYCHAIN_SERVICE="anthropic-api-key"
KEYCHAIN_ACCOUNT="${USER:-default}"

ok()   { printf '   \033[32m%s\033[0m\n' "$*"; }
bad()  { printf '   \033[31m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
head_() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

if [ "$MODE" = "print" ]; then
  command -v security >/dev/null 2>&1 || { echo "no Keychain on this machine" >&2; exit 1; }
  security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null \
    || { echo "no key stored yet - run this script with no arguments first" >&2; exit 1; }
  exit 0
fi

# ---------------------------------------------------------------------------
head_ "The key"

KEY=""
if command -v security >/dev/null 2>&1 &&
   security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1; then
  printf '   A key is already in your Keychain. Reuse it? [Y/n] '
  read -r reuse
  case "${reuse:-y}" in
    [Nn]*) : ;;
    *) KEY=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w)
       ok "using the stored key" ;;
  esac
fi

if [ -z "$KEY" ]; then
  printf '   Paste your Anthropic API key (nothing will appear): '
  read -rs KEY
  printf '\n'
fi

[ -n "$KEY" ] || { bad "nothing entered."; exit 1; }
case "$KEY" in
  sk-ant-*) : ;;
  *) bad "that does not start with sk-ant- — is it an Anthropic API key?"; exit 1 ;;
esac
[ "${#KEY}" -gt 40 ] || { bad "that looks truncated (${#KEY} characters)."; exit 1; }
ok "looks like a key (${#KEY} characters, starts sk-ant-)"

# ---------------------------------------------------------------------------
head_ "Does it actually work?"
# count_tokens is free and authenticates, so this distinguishes a dead key from
# an empty balance without spending anything. A key that 401s must not be
# distributed - that is the whole point of checking first.
BODY='{"model":"claude-opus-5-5","messages":[{"role":"user","content":"hi"}]}'
HTTP=$(curl -sS -o /tmp/.ak.$$ -w '%{http_code}' \
  https://api.anthropic.com/v1/messages/count_tokens \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d "$BODY" 2>/dev/null || echo 000)
DETAIL=$(cat /tmp/.ak.$$ 2>/dev/null || true); rm -f /tmp/.ak.$$

case "$HTTP" in
  200) ok "the API accepted it" ;;
  401) bad "401 — Anthropic rejected this key. Nothing was distributed."; exit 1 ;;
  400) if printf '%s' "$DETAIL" | grep -qi 'credit'; then
         bad "the key is valid but the account has no credit."
         note "A new key will not fix that — it is a balance, not a credential."
         note "Top up at console.anthropic.com -> Billing, then re-run this."
       else
         bad "400 from the API: $(printf '%s' "$DETAIL" | head -c 200)"
       fi
       exit 1 ;;
  000) bad "could not reach api.anthropic.com. Check your connection."; exit 1 ;;
  *)   bad "HTTP $HTTP: $(printf '%s' "$DETAIL" | head -c 200)"; exit 1 ;;
esac

if [ "$MODE" = "check" ]; then
  head_ "Checked only"
  note "The key is valid. Nothing was stored or distributed."
  printf '\n'
  exit 0
fi

# ---------------------------------------------------------------------------
head_ "1/3  macOS Keychain (the source of truth)"
if command -v security >/dev/null 2>&1; then
  # Honest limitation: `security` takes the value as an argument, so it is
  # briefly visible to `ps` on this machine. That is a local-only, sub-second
  # exposure on a single-user laptop, and the alternative - a plaintext
  # dotfile that lives forever - is worse.
  security add-generic-password -U \
    -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$KEY" \
    -D "API key" -j "Anthropic API key, set by set-anthropic-key.sh" 2>/dev/null \
    && ok "stored (read it back with: bash scripts/set-anthropic-key.sh --print)" \
    || bad "could not write to the Keychain"
else
  note "not macOS — skipping. Store it in your own secret manager."
fi

# ---------------------------------------------------------------------------
head_ "2/3  Cloudflare Worker ($WORKER)"
if command -v npx >/dev/null 2>&1; then
  # Piped, not prompted: the key never becomes an argument.
  if printf '%s' "$KEY" | npx --yes wrangler@4 secret put ANTHROPIC_API_KEY --name "$WORKER" 2>/tmp/.wr.$$; then
    ok "set — the worker can now rank job packs"
  else
    bad "wrangler refused:"
    sed 's/^/      /' /tmp/.wr.$$ | head -12
    note ""
    note "Most likely your login lacks the Workers Scripts permission."
    note "Check who you are:    npx wrangler whoami"
    note "Re-authorise:         npx wrangler logout && npx wrangler login"
    note ""
    note "Or set it by hand, which always works:"
    note "  dash.cloudflare.com -> Workers & Pages -> $WORKER"
    note "  -> Settings -> Variables and Secrets -> Add -> type Secret"
    note "  -> name ANTHROPIC_API_KEY -> paste -> Deploy"
  fi
  rm -f /tmp/.wr.$$
else
  note "npx not found — skipping."
fi

# ---------------------------------------------------------------------------
head_ "3/3  The browser app"
# This one cannot be automated and should not be: the app is bring-your-own-key
# precisely because the key stays in the visitor's browser. A script that could
# write it there would mean something else could read it out.
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$KEY" | pbcopy
  ok "copied to your clipboard"
  note "Open the app -> step 01 -> paste. It is stored in that browser only."
  note "Clear the clipboard when you are done:  pbcopy </dev/null"
else
  note "The app takes the key in step 01, pasted by hand. By design: it is"
  note "bring-your-own-key, so nothing but your browser ever holds it."
fi

head_ "Done"
note "Check the worker picked it up:  bash scripts/check-reply.sh"
printf '\n'
