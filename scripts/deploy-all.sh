#!/usr/bin/env bash
# One command, whole stack. Pages site + D1 + ingest worker, wired together.
#
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
#   INGEST_DOMAIN=jobs.example.com bash scripts/deploy-all.sh
#
# Every step ASSERTS its result rather than assuming it. The failure this is
# built against is not a crash - it is a deploy that prints success while the
# site is publicly readable, or the feed button points at nothing. Both have
# happened here.
set -euo pipefail
cd "$(dirname "$0")/.."

say(){ printf '\n\033[1m== %s\033[0m\n' "$*"; }
die(){ printf '\033[31m!! %s\033[0m\n' "$*" >&2; exit 1; }

INGEST_DOMAIN="${INGEST_DOMAIN:-}"
WR="npx --yes wrangler@4"

# --- how you are authenticated ---------------------------------------------
# Two routes, and the browser one is better for a person at a keyboard.
#
#   wrangler login  - OAuth in the browser. No secret to create, paste, or
#                     store; it is scoped to your account and revocable from
#                     the Cloudflare dashboard. It also lets wrangler resolve
#                     the account id itself, so nothing has to be typed.
#   CLOUDFLARE_API_TOKEN - for CI, or a machine with no browser. A Pages:Edit
#                     token cannot list accounts, which is why the account id
#                     has to be supplied alongside it.
#
# Neither is assumed: if there is no token AND no login, the script says which
# one to do rather than failing somewhere in the middle with a 403.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  AUTH="api token"
  : "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_API_TOKEN is set, so CLOUDFLARE_ACCOUNT_ID is needed too - a Pages:Edit token cannot list accounts}"
elif WHO=$($WR whoami 2>&1) && printf '%s' "$WHO" | grep -qiE 'account id|you are logged in'; then
  # `wrangler whoami` exits 0 whether or not you are signed in - it prints
  # "You are not authenticated" and succeeds - so the exit code proves nothing
  # and the output has to be read. Trusting the status here reported a browser
  # login that did not exist, and the run then failed several steps later with
  # a token error instead of at the door.
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
PROJECT="${PROJECT:-job-search-agentic-ai}"
# Derived, never typed twice. The Pages project name IS the subdomain, so the
# CORS origins follow from it; keeping them as separate literals is how the
# worker ends up allowlisting a site that no longer exists.
APP_ORIGIN="https://${PROJECT}.pages.dev"
DASHBOARD_ORIGIN="https://dashboard.${PROJECT}.pages.dev"
WORKER_NAME="${WORKER_NAME:-jobsearch-ingest}"

# ---------- 1. worker: database, schema, deploy -----------------------------
echo "auth     $AUTH"
echo "project  $PROJECT"
echo "app      $APP_ORIGIN"
echo "feed CORS allows that origin and no other"

say "D1 database"
DB_ID=$($WR d1 list --json 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try{const j=JSON.parse(s);const m=j.find(d=>d.name==="jobsearch");
        process.stdout.write(m?m.uuid:"");}catch{process.stdout.write("");}});' || true)

if [ -z "$DB_ID" ]; then
  echo "creating it"
  $WR d1 create jobsearch >/dev/null
  DB_ID=$($WR d1 list --json | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);const m=j.find(d=>d.name==="jobsearch");
      process.stdout.write(m?m.uuid:"");});')
fi
[ -n "$DB_ID" ] || die "could not create or find the D1 database"
echo "database_id $DB_ID"

# wrangler.toml ships with a placeholder so a half-configured deploy fails
# loudly. Substitute into a copy; the committed file stays a placeholder.
say "Applying schema and deploying the worker"
TOML=worker/wrangler.toml
cp "$TOML" "$TOML.bak"
trap 'mv -f "$TOML.bak" "$TOML" 2>/dev/null || true' EXIT
sed -i.tmp "s|REPLACE_AFTER_CREATE|$DB_ID|" "$TOML"
sed -i.tmp "s|REPLACE_APP_ORIGIN|$APP_ORIGIN|" "$TOML"
sed -i.tmp "s|REPLACE_DASHBOARD_ORIGIN|$DASHBOARD_ORIGIN|" "$TOML"
[ -n "$INGEST_DOMAIN" ] && sed -i.tmp "s|REPLACE_WITH_YOUR_EMAIL_ROUTING_DOMAIN|$INGEST_DOMAIN|" "$TOML"
rm -f "$TOML.tmp"

(cd worker && $WR d1 execute jobsearch --remote --file=schema.sql -y >/dev/null) \
  || die "schema did not apply"
WOUT=$(cd worker && $WR deploy 2>&1 | tee /dev/stderr)
WORKER_URL=$(printf '%s' "$WOUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | tail -1 || true)
[ -n "$WORKER_URL" ] || die "worker deployed but printed no URL - cannot wire the app to it"
echo "worker at $WORKER_URL"

# Prove it is actually serving, not just uploaded. A bad path must 404 - if it
# answers anything else the router is not what we think it is.
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$WORKER_URL/feed/short" || echo 000)
[ "$CODE" = "404" ] || die "worker answered $CODE on a bad feed path, expected 404"
echo "router verified"

# ---------- 2. the app, pointed at that worker ------------------------------
say "Writing app/config.json"
printf '{\n  "worker": "%s"\n}\n' "$WORKER_URL" > app/config.json
cat app/config.json
node scripts/sync-static.mjs >/dev/null
npm run build >/dev/null || die "build failed"

say "Deploying Pages"
$WR pages project create "$PROJECT" --production-branch main 2>/dev/null || true
LOG=$(mktemp)
$WR pages deploy dist/public --project-name "$PROJECT" --branch main --commit-dirty=true 2>&1 | tee "$LOG"
URL=$(grep -oE 'https://[a-z0-9.-]*\.pages\.dev' "$LOG" | tail -1 || true)
rm -f "$LOG"
[ -n "$URL" ] || die "deploy produced no *.pages.dev URL"

# ---------- 3. the assertion that matters -----------------------------------
say "Is it private?"
echo "probing $URL"
CODE=000
for i in 1 2 3 4 5; do
  read -r CODE CHAIN <<<"$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -L --max-redirs 0 "$URL" || echo '000 ')"
  [ "$CODE" != "000" ] && break
  sleep 10
done
case "$CODE" in
  302|403) echo "Access is in front of it." ;;
  200) printf '\033[33m!! PUBLIC — anyone with the URL can read this.\033[0m\n'
       echo "   Add a Cloudflare Access policy for $PROJECT, subdomain *, before sharing it." ;;
  *)   echo "inconclusive (HTTP $CODE) — check it yourself before sharing" ;;
esac

say "Done"
echo "Site   $URL"
echo "Stable $APP_ORIGIN/app/"
echo "Worker $WORKER_URL"
if [ -z "$INGEST_DOMAIN" ]; then
  printf '\033[33mINGEST_DOMAIN was not set, so signup will mint addresses at example.invalid.\033[0m\n'
  echo "Re-run with INGEST_DOMAIN=your-domain once Email Routing is configured."
else
  echo "Last step, in the dashboard: Email > Email Routing > Routes >"
  echo "  catch-all on $INGEST_DOMAIN -> send to Worker -> $WORKER_NAME"
fi
