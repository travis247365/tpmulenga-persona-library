/**
 * Service worker for the Job Search Agentic AI Engine.
 *
 * The app shell is cached so the thing opens from the home screen without a
 * connection - which on a phone is the difference between a tool and a
 * bookmark. The CV parsers are 2.3MB of that shell, so they are precached
 * deliberately: a CV dropped in on a bad connection should still parse.
 *
 * Two things are NEVER cached, and both would be bugs if they were:
 *   config.json  - it names the worker, and a stale copy points the app at an
 *                  origin that may no longer exist. Network first, always.
 *   /feed/, /signup - live data and a mutation. A cached feed is a lie about
 *                  what has arrived, and a cached signup is incoherent.
 *
 * api.anthropic.com is never touched here either: the key and the CV go
 * straight from the page, and a worker sitting in that path would be exactly
 * the interception the page promises does not happen.
 */
const VERSION = "jsae-v2";
const SHELL = [
  "./",
  "./index.html",
  "./tokens.css",
  "./manifest.webmanifest",
  "./brand/fonts/poppins-400.woff2",
  "./brand/fonts/poppins-500.woff2",
  "./brand/fonts/poppins-700.woff2",
  "./brand/tpc_black.png",
  "./brand/tpc_white.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./vendor/pdf.min.mjs",
  "./vendor/pdf.worker.min.mjs",
  "./vendor/mammoth.browser.min.js",
];

self.addEventListener("install", (e) => {
  // addAll is atomic: one missing file and the whole install fails, which is
  // the behaviour we want - a half-populated shell fails at the worst moment.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                      // signup POSTs pass through

  const url = new URL(req.url);
  const live = url.pathname.endsWith("/config.json")
            || url.pathname.includes("/feed/")
            || url.pathname.includes("/signup");
  if (live || url.origin !== self.location.origin) return;

  // Cache first for the shell, and refresh in the background so a redeploy is
  // picked up on the next open rather than never.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
