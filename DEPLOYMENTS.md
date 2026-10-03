# Deployment log

Append a block per deploy. Record what was actually observed, including the
probe result — a deploy that printed a warning is more useful later than one
remembered as fine.

Facts that stay true across deploys:

| | |
|---|---|
| Cloudflare account | `d275d4188811030de4b3518a7f610a93` |
| Pages project | `job-search-agentic-ai` |
| Stable site | https://job-search-agentic-ai.pages.dev |
| App | https://job-search-agentic-ai.pages.dev/app/ |
| Worker | https://jobsearch-ingest.travis-mulenga.workers.dev |
| D1 database | `jobsearch` · `0a5499db-be19-416d-aabc-c3edd145df32` |

Deploy with `bash scripts/deploy-all.sh` after `npx wrangler login`. It creates
what is missing and asserts each step, so re-running it is safe.

---

## 2026-10-03 · rename, the key note, and the gating fix all land

Branch at `43bc661`, pulled from `fe8a361` — so this deploy carried four
commits' worth of app changes at once. Auth: browser login. wrangler 4.147.0
(was 4.141.0; it now prints a telemetry notice, which is noise, not a change).

- Pages: **3 files uploaded**, 431 already there — `index.html`,
  `manifest.webmanifest`, `sw.js`. Exactly the three the rename touches.
- Worker version `3c53c885-f35d-4da9-8980-55780cc7dd9d`. Unchanged code;
  re-deployed because the script always does. Bindings identical, including
  `INGEST_DOMAIN=jobs.travispaulconsulting.co`.
- Router verified; D1 reused.
- Alias https://129a740a.job-search-agentic-ai.pages.dev

**What is finally live**

- `b1f91d7` — *Build my personas* is disabled until the key field holds
  something that looks like a key. This was pending across two deploys; the
  dead-end click is gone.
- `e0eb9e0` — the page is the **TP Consulting.Co Job Search Agentic AI Engine**
  in title, manifest and eyebrow (home-screen label stays `Job Search AI`
  because iOS truncates), and step 01 carries the closed-by-default
  *How to get your Anthropic key* note.
- `43bc661` — tab icon, branded links, privacy box stacks on a phone.

The service worker version went `pf-v1` → `jsae-v2` in this deploy. That is the
only reason the rename reaches an already-installed home-screen app: the old
shell was cached under the old key and would otherwise have kept serving the
old title indefinitely.

Verified before the deploy by driving the real files in Chromium at 390px —
21 assertions, all passing, no console errors and no failed requests. Not
verified against the live URL: this container's egress policy denies
`pages.dev`, so every claim about the deployed site rests on the deploy output
above, not on a fetch of it.

**Privacy probe: PUBLIC.** Third consecutive deploy reporting this. Still no
Access policy.

**Still outstanding, both dashboard-only**

1. Cloudflare Access policy on `job-search-agentic-ai`, subdomain `*`.
2. Email Routing catch-all on `jobs.travispaulconsulting.co` → Worker
   `jobsearch-ingest`. Signup hands out an address that still receives nothing.
   Worth checking when adding it: Email Routing is enabled per zone, so if only
   `travispaulconsulting.co` is a zone, the receiving address may need to be the
   apex rather than the `jobs.` subdomain — which would mean a redeploy with
   that value.

---

## 2026-09-27 · ingest domain set, third deploy

Branch at `fe8a361`. Auth: browser login.

- **`INGEST_DOMAIN=jobs.travispaulconsulting.co`** — the worker now holds a real
  domain instead of the placeholder, so signup mints addresses rather than
  refusing. Worker version `00f9b5e8-c4c3-4034-bc4a-3c3a0fa442d7`.
- Pages: 1 file changed, 433 already uploaded — `config.json` only.
- Router verified; D1 reused.
- Alias https://8c249d2a.job-search-agentic-ai.pages.dev

**Privacy probe: PUBLIC**, reported correctly. The widened window worked — this
run got a real answer instead of the `000` timeout the fresh hostname produced.

**Two things this deploy did NOT include**

1. `b1f91d7` was not pulled, so the deployed app is still the version where
   *Build my personas* is live with no key and only fails on press. Pull and
   re-run to pick it up.
2. Email Routing has no rule yet, so nothing forwards to the worker. Signup now
   hands out a *plausible* address that still receives nothing until the
   catch-all exists — better than the placeholder, not yet working.

**Worth checking when adding the rule:** Cloudflare Email Routing is enabled per
zone. If only `travispaulconsulting.co` is a zone, the address that actually
receives may be `jobs+<token>@travispaulconsulting.co`, not the `jobs.`
subdomain. Whatever the Routes page accepts is the truth; if it is the apex,
re-run with `INGEST_DOMAIN=travispaulconsulting.co`.

---

## 2026-09-27 · old project deleted, browser login in use

Branch at `a9d062a`. Auth: **browser login** (`npx wrangler login`), first use
of the OAuth path — no token involved.

- `tpm-persona-library` **deleted**. It was still serving the whole site at its
  old URL with no Access policy over it, which a rename leaves behind: not an
  idle resource but a second live copy nobody is watching.
- Confirmed by the listing the script prints afterwards — `job-search-agentic-ai`
  is the only project on the account.
- The API token created for the first two deploys is now redundant and should
  be deleted from the Cloudflare profile. An unused credential is a liability
  with no upside.

**Still open**
- Access policy on `job-search-agentic-ai` — the site is public until it exists.
- `INGEST_DOMAIN` unset, so signup mints addresses that receive nothing.

---

## 2026-09-27 · renamed project, second deploy

Branch `claude/epic-thompson-hgbsmp` at `13cf38a`. Auth: API token.

- **Pages project `job-search-agentic-ai` created.** Pages projects cannot be
  renamed, so the new URL meant a new project. 434 files uploaded in 26s.
- **Worker redeployed** — version `8074615b-d062-4231-b460-d6d46292d81b`.
  `APP_ORIGIN` now reads `https://job-search-agentic-ai.pages.dev`, which is
  the point of the redeploy: the CORS check is fail-closed, so the worker
  serving the old origin would have blocked signup and the feed from the new
  site with nothing in the UI to explain it.
- **D1 reused** — same database as the first deploy, schema already applied.
- **Router verified** — the worker answered 404 on a bad feed path before the
  app was pointed at it.
- **Deployment alias** https://f50f4441.job-search-agentic-ai.pages.dev

**Privacy probe: INCONCLUSIVE (HTTP 000, all five attempts).** A brand-new
Pages hostname had not propagated yet. This says nothing about whether the site
is private, and the retry window has since been widened to two minutes with an
explicit message, because "inconclusive" on a first deploy is exactly when the
answer matters most.

**Open after this deploy**
- Access policy not yet applied → assume **PUBLIC** until confirmed otherwise.
- `INGEST_DOMAIN` unset → the worker holds the placeholder, so signup mints
  `jobs+<token>@example.invalid`, which receives nothing. Re-run with
  `INGEST_DOMAIN=` set once Email Routing exists.
- Old project `tpm-persona-library` still exists and is publicly readable.
  Delete it.

---

## 2026-09-26 · first deploy

Branch `claude/epic-thompson-hgbsmp` at `f584a72`. Auth: API token.

- D1 `jobsearch` created — `0a5499db-be19-416d-aabc-c3edd145df32`
- Schema applied; worker deployed, version
  `bfcf240b-9a75-44a7-b570-33afdaf6b826`; router verified
- Pages project `tpm-persona-library`, alias
  https://5f8a3efd.tpm-persona-library.pages.dev

**Privacy probe: PUBLIC.** Reported correctly and acted on by renaming and
re-deploying; Access still outstanding.

Two build-environment fixes were needed first, both on the Mac: `pnpm install`
had skipped the postinstall scripts for `esbuild` and `@tailwindcss/oxide`, so
`npm run build` would have failed after the worker was already deployed.
`pnpm approve-builds` for both, then a clean build.
