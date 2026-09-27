# Deploying to Cloudflare Pages, privately

**Live:** https://job-search-agentic-ai.pages.dev/personas/ — project
`job-search-agentic-ai`, first deployed 26 Sep 2026, 400 files. Verified loading.

**Access is not yet configured, so it is public.** Until the policy below exists,
treat the URL as readable by anyone who has it.

This is the one free-and-private combination among the hosts tried: Pages is
free, and Cloudflare Access is free for small teams. It beats Fly (private but
blocked by an overdue invoice), Vercel (private is paid) and Replit (private and
deployment both paid).

```sh
# 1. create a token: Account > Cloudflare Pages > Edit
#    https://dash.cloudflare.com/profile/api-tokens
# 2. copy it to the clipboard
bash scripts/cloudflare-deploy.sh
```

## Pages alone is public — Access is the private half

A Pages deployment is on the internet the moment it finishes. Access is a
separate thing configured in the Zero Trust dashboard, and there is no flag on
the deploy that turns it on.

This is the same failure shape as Fly allocating public IPs by default: the
insecure state is the default, and a checklist item is easy to skim past. So the
script does not trust it. After deploying it probes the live URL and reports one
of three states:

| Result | Meaning |
|---|---|
| redirect to `cloudflareaccess.com` | protected — Access is in front |
| HTTP 200, no redirect | **public** — script exits 2 with the steps to fix it |
| anything else | inconclusive — exits 2, since propagation can lag |

It never prints success on an unverified deployment.

## Turning Access on

1. https://one.dash.cloudflare.com → **Access** → **Applications**
2. **Add an application** → **Self-hosted**
3. Application domain: `job-search-agentic-ai.pages.dev`, with subdomain `*`.
   The wildcard is not optional: every deployment gets its own hash prefix
   (the first was `b4d809cd`), so protecting only the bare hostname leaves
   every preview URL open.
4. Add a policy: **Action = Allow**, **Include → Emails → travis.mulenga@gmail.com**
5. Save, then re-run the script to confirm it now redirects

Add a second email to the same policy for anyone else who should read it. Access
sends each a one-time code, so no account or password is needed on their side —
which is what makes it workable for sending a portfolio to a recruiter.

## What this does not protect

Access guards the hostname. It does not make the repository private, and it does
not retroactively cover anything already crawled while the deployment was public.
Configure Access before sharing the URL, not after.

## Network access from a cloud session

`api.cloudflare.com` and `dash.cloudflare.com` are denied by the environment's
egress policy, so this cannot run from a session there — `registry.npmjs.org` is
reachable, so `wrangler` installs, but the API calls fail. Run it from the Mac,
or add both hosts to the allowed domains.

## Already private, with no deploy at all

The library is published as a Claude Artifact, private to its owner until shared:

  https://claude.ai/artifact/K5WpAs6i9oXYXE9G8XhWMu

Cloudflare adds a custom hostname and per-person access you control. It does not
add privacy that isn't already there.
