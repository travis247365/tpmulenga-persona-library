#!/usr/bin/env bash
# Delete a Cloudflare Pages project and everything it serves.
#
#   bash scripts/delete-pages-project.sh tpm-persona-library
#
# Renaming a Pages project is not possible, so a rename leaves the old project
# deployed and publicly readable at its old URL. That is worse than an unused
# resource: it is a second copy of the site that no Access policy covers and
# that nobody is watching.
#
# This is irreversible and the deployments go with it, so it lists the project
# and requires the name to be typed back before doing anything.
set -euo pipefail
cd "$(dirname "$0")/.."
WR="npx --yes wrangler@4"
. "$(dirname "$0")/lib-cf-auth.sh"

NAME="${1:-}"
[ -n "$NAME" ] || { echo "usage: $0 <pages-project-name>" >&2; exit 2; }

echo "auth $AUTH"
echo
echo "Projects on this account:"
$WR pages project list 2>&1 | sed 's/^/  /'

cat <<MSG

About to DELETE the Pages project "$NAME".
This removes the project, every deployment in it, and the *.pages.dev
hostnames it serves. It cannot be undone.
MSG
printf 'Type the project name to confirm: '
read -r CONFIRM
[ "$CONFIRM" = "$NAME" ] || { echo "Names did not match. Nothing was deleted."; exit 1; }

$WR pages project delete "$NAME" --yes
echo
echo "Deleted $NAME. Confirm it is gone:"
$WR pages project list 2>&1 | sed 's/^/  /'
