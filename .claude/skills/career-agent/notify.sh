#!/usr/bin/env bash
# Push a career-agent event to ntfy (iOS).
#
#   notify.sh <event> <title> <body> [click-url]
#
# <event> is one of:
#   match        a role scoring 4+ appeared in the inbox
#   application  an application was submitted or acknowledged
#   reply        a recruiter or job poster responded
#
# Requires NTFY_URL, the full topic URL, e.g. https://ntfy.sh/<topic>.
# Set it as an environment secret, never in this file: on ntfy.sh the topic
# string is the only thing protecting these notifications, and anyone who
# knows it can read every one. Prefer a long random topic, or a server with
# access control plus NTFY_TOKEN, which is sent as a bearer token.
#
# Publishes via ntfy's JSON API rather than X-Title headers, because HTTP
# headers are latin-1 and these titles carry names and punctuation that
# would otherwise arrive mojibaked.

set -euo pipefail

# Fall back to ntfy.conf beside this script. It is gitignored because the
# topic string is the only thing protecting these notifications.
if [[ -z "${NTFY_URL:-}" ]]; then
  conf="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ntfy.conf"
  # shellcheck source=/dev/null
  [[ -r "$conf" ]] && source "$conf"
fi

[[ -n "${NTFY_URL:-}" ]] || {
  echo "notify.sh: no NTFY_URL in the environment or ntfy.conf" >&2; exit 78; }

event=${1:?event required}
title=${2:?title required}
body=${3:?body required}
click=${4:-}

case "$event" in
  match)       prio=3; tag=briefcase ;;
  application) prio=3; tag=outbox_tray ;;
  reply)       prio=4; tag=envelope_with_arrow ;;
  *) echo "notify.sh: unknown event '$event'" >&2; exit 64 ;;
esac

# Split the topic URL into server root and topic, as the JSON API requires.
server=${NTFY_URL%/*}
topic=${NTFY_URL##*/}
[[ -n "$topic" && "$server" != "$NTFY_URL" ]] || {
  echo "notify.sh: NTFY_URL must be a full topic URL, e.g. https://ntfy.sh/<topic>" >&2
  exit 78
}

payload=$(TITLE=$title BODY=$body CLICK=$click TOPIC=$topic PRIO=$prio TAG=$tag \
  python3 -c '
import json, os
d = {"topic": os.environ["TOPIC"], "title": os.environ["TITLE"],
     "message": os.environ["BODY"], "priority": int(os.environ["PRIO"]),
     "tags": [os.environ["TAG"]]}
if os.environ["CLICK"]:
    d["click"] = os.environ["CLICK"]
print(json.dumps(d))')

args=(-fsS --max-time 20 --retry 3 --retry-connrefused
      -H "Content-Type: application/json")
[[ -n "${NTFY_TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $NTFY_TOKEN")

printf '%s' "$payload" | curl "${args[@]}" -d @- "$server" >/dev/null
