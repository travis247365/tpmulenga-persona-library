/**
 * The worker's single entry point.
 *
 * Cloudflare runs ONE module per worker, and `main` once pointed at email.js,
 * which exports only an `email` handler. The whole feed API was therefore never
 * routed - the code existed, the tests passed, and nothing served it. Every
 * handler has to leave from the same module.
 */
import { handleEmail } from "./email.js";
import { handleFetch } from "./api.js";
import { handleSignup } from "./signup.js";
import { handleProfile } from "./profile.js";

export default {
  email: handleEmail,

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The app is served from another origin, so the browser preflights the
    // signup POST. Answer it from the same allowlist the feed uses - never "*".
    if (request.method === "OPTIONS") {
      const headers = { "access-control-allow-methods": "GET, POST, OPTIONS",
                        "access-control-allow-headers": "content-type" };
      if (env.APP_ORIGIN) {
        headers["access-control-allow-origin"] = env.APP_ORIGIN;
        headers["vary"] = "origin";
      }
      return new Response(null, { status: 204, headers });
    }

    // The derived profile the ranking reads. Same CORS treatment as signup:
    // named origin or no header at all, never "*".
    const profile = url.pathname.match(/^\/profile\/([a-z0-9]{24,})$/);
    if (profile) {
      const res = await handleProfile(request, env, profile[1]);
      if (env.APP_ORIGIN) {
        res.headers.set("access-control-allow-origin", env.APP_ORIGIN);
        res.headers.set("vary", "origin");
      }
      return res;
    }

    if (url.pathname === "/signup") {
      const res = await handleSignup(request, env);
      if (env.APP_ORIGIN) {
        res.headers.set("access-control-allow-origin", env.APP_ORIGIN);
        res.headers.set("vary", "origin");
      }
      return res;
    }

    return handleFetch(request, env, ctx);
  },
};
