#!/usr/bin/env bash
# What actually happened to the job-pack pipeline.
#
#   bash scripts/check-reply.sh
#
# Every stage of this thing fails quietly by design - a disallowed sender is
# logged not bounced, a ranking failure downgrades the pack instead of losing
# it, a capped day records and moves on. That is the right behaviour for a mail
# handler and the wrong behaviour for a person trying to work out why no pack
# arrived. This prints the audit trail that makes it answerable.
set -euo pipefail
cd "$(dirname "$0")/.."

WR="npx --yes wrangler@4"
. "$(dirname "$0")/lib-cf-auth.sh"

q() { $WR d1 execute jobsearch --remote --command "$1" 2>/dev/null || true; }

printf '\n\033[1m== Is the operator key set on the worker?\033[0m\n'
# secret list shows NAMES only - the value is never retrievable, which is the
# point of a secret. Absent here means ranking cannot run at all.
if $WR secret list --name jobsearch-ingest 2>/dev/null | grep -q ANTHROPIC_API_KEY; then
  echo "   ANTHROPIC_API_KEY is set"
else
  echo "   ANTHROPIC_API_KEY is NOT set — packs will go out unranked."
  echo "   Fix: npx wrangler secret put ANTHROPIC_API_KEY --name jobsearch-ingest"
fi

printf '\n\033[1m== Who is set up to receive a pack\033[0m\n'
q "SELECT a.label, r.deliver_to, r.enabled, r.max_per_day
     FROM reply_settings r JOIN accounts a ON a.id = r.account_id;"

printf '\n\033[1m== Has a profile been uploaded (no profile = no ranking)\033[0m\n'
q "SELECT a.label, LENGTH(p.json) AS bytes,
          datetime(p.updated/1000,'unixepoch') AS updated
     FROM profiles p JOIN accounts a ON a.id = p.account_id;"

printf '\n\033[1m== The last 10 packs, and why each one went the way it did\033[0m\n'
q "SELECT datetime(at/1000,'unixepoch') AS at, status, job_count, detail
     FROM digests ORDER BY id DESC LIMIT 10;"

printf '\n\033[1m== Roles captured in the last 7 days\033[0m\n'
q "SELECT COUNT(*) AS roles FROM jobs WHERE found_at > (strftime('%s','now')-604800)*1000;"

printf '\n\033[1m== Mail that reached a valid address from a sender not on the allowlist\033[0m\n'
# A non-empty list here is usually the answer to "why is my feed empty": the
# allowlist is four addresses, and anything else is recorded and dropped.
q "SELECT sender, COUNT(*) AS n, MAX(datetime(at/1000,'unixepoch')) AS last
     FROM rejected GROUP BY sender ORDER BY n DESC LIMIT 10;"

printf '\n\033[1mNo digests rows at all?\033[0m Then no allowed mail has reached the worker yet —\n'
printf 'check Email Routing has a route pointing at jobsearch-ingest.\n\n'
