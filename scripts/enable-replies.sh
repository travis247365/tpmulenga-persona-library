#!/usr/bin/env bash
# Switch the mailed job pack on for one feed.
#
#   bash scripts/enable-replies.sh <token> you@example.com [max_per_day]
#
# Replies are OFF for every account until a row exists here, so a public
# signup can never cause mail to be sent. Two things must both be true before
# a pack can arrive:
#
#   1. this row, naming where to send
#   2. the address verified as an Email Routing destination in Cloudflare,
#      AND named in wrangler.toml via REPLY_TO at deploy time
#
# The binding refuses anything else, so (2) is enforced by the platform.
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="${1:-}"; TO="${2:-}"; MAX="${3:-6}"
[ -n "$TOKEN" ] && [ -n "$TO" ] || {
  echo "usage: bash scripts/enable-replies.sh <token> <you@example.com> [max_per_day]" >&2
  exit 1
}
case "$TO" in *@*.*) : ;; *) echo "'$TO' is not an email address" >&2; exit 1 ;; esac

WR="npx --yes wrangler@4"
. "$(dirname "$0")/lib-cf-auth.sh"

SQL="INSERT INTO reply_settings (account_id, deliver_to, enabled, max_per_day, updated)
     SELECT id, '$TO', 1, $MAX, $(date +%s)000 FROM accounts WHERE token = '$TOKEN'
     ON CONFLICT(account_id) DO UPDATE SET
       deliver_to = excluded.deliver_to, enabled = 1,
       max_per_day = excluded.max_per_day, updated = excluded.updated;"

$WR d1 execute jobsearch --remote --command "$SQL"

# Assert rather than assume: a token that matches no account inserts no row
# and the command above still exits 0, which is exactly the silent success
# this script exists to avoid.
echo
echo "Confirming:"
$WR d1 execute jobsearch --remote --json --command \
  "SELECT a.label, r.deliver_to, r.enabled, r.max_per_day
     FROM reply_settings r JOIN accounts a ON a.id = r.account_id
    WHERE a.token = '$TOKEN';" \
  | grep -q "$TO" \
  && echo "   replies ON for this feed -> $TO (max $MAX/day)" \
  || { echo "   NO ROW WRITTEN - is that token right?" >&2; exit 1; }
