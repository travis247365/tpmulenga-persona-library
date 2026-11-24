# Deploying to Vercel

Static only. `vercel.json` builds with Vite and serves `dist/public`, so the
Express server in `server/` is not used — a portfolio page needs no server, and
a static deployment has less to go wrong.

```sh
npm i -g vercel
vercel login
vercel                 # preview deployment
vercel --prod          # production
```

## Privacy — read before deploying

**A Vercel production deployment is public by default.** Putting it behind
authentication or a password is a paid feature; on the free tier, protection
covers preview deployments but not production.

This matters because the app was specified as private. Three honest options:

1. **Deploy previews only.** `vercel` without `--prod` gives a URL that
   Deployment Protection can cover on the free tier. The URL changes per
   deployment, which is fine for something you open yourself.
2. **Pay for protection**, then enable Vercel Authentication on production.
3. **Use Fly instead**, where a private app costs nothing — `scripts/fly-deploy.sh`.
   That path is blocked only by an overdue Fly invoice, not by any plan limit.

`X-Robots-Tag: noindex, nofollow, noarchive` is set on every response, so a
public deployment at least stays out of search results. That is obscurity, not
privacy: anyone with the URL can still read it. Do not treat it as protection.

## What is already private, at no cost

The persona library is published as a Claude Artifact, private to the owner
until explicitly shared:

  https://claude.ai/artifact/K5WpAs6i9oXYXE9G8XhWMu

If the goal is "somewhere private to read and share the personas", that is
already done. Fly and Vercel add a custom domain and a real hostname, not
privacy.

## Network access

`vercel.com` and `api.vercel.com` are denied by the cloud environment's egress
policy, so the CLI cannot run from a session there. Add both to the allowed
domains, or deploy from the Mac.
