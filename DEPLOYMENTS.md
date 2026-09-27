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
