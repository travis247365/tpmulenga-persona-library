# Cloudflare authentication, shared by every deploy script here.
#
# Sourced, not executed. Sets AUTH to a human-readable description, and exits
# with instructions if there is no usable credential - at the door, rather than
# several steps in with a 403 that does not name the cause.
#
# Two routes:
#   wrangler login        OAuth in the browser. Nothing to create, paste or
#                         store; revocable from the dashboard, and wrangler
#                         resolves the account id itself.
#   CLOUDFLARE_API_TOKEN  CI or a headless machine. Needs the account id too,
#                         because a Pages:Edit token cannot list accounts.
: "${WR:=npx --yes wrangler@4}"

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  AUTH="api token"
  : "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_API_TOKEN is set, so CLOUDFLARE_ACCOUNT_ID is needed too - a Pages:Edit token cannot list accounts}"
# `wrangler whoami` exits 0 whether or not you are signed in - it prints
# "You are not authenticated" and succeeds - so the exit status proves nothing
# and the output has to be read.
elif WHO=$($WR whoami 2>&1) && printf '%s' "$WHO" | grep -qiE 'account id|you are logged in'; then
  AUTH="browser login"
else
  cat >&2 <<'MSG'
Not signed in to Cloudflare, and no API token set. Pick one:

  npx wrangler login          <- simplest. Opens your browser, no token to
                                 create or keep. Then re-run this script.

  export CLOUDFLARE_API_TOKEN=...      for CI or a headless machine
  export CLOUDFLARE_ACCOUNT_ID=...     (needed with a token: a Pages:Edit
                                        token cannot list accounts)
MSG
  exit 1
fi
