/**
 * Read-only feed for the dashboard. The token in the path is the same bearer
 * credential as the ingest address, so it is compared in constant time and
 * never logged.
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/feed\/([a-z0-9]{24,})$/);
    if (!m) return new Response("not found", { status: 404 });

    const row = await env.DB.prepare(
      "SELECT id, token FROM accounts WHERE token = ?"
    ).bind(m[1]).first();
    if (!row || !timingSafeEqual(row.token, m[1])) {
      return new Response("not found", { status: 404 });   // same shape as a bad path
    }

    const { results } = await env.DB.prepare(
      `SELECT job_id, subject, sender, received_at FROM alerts
       WHERE account_id = ? AND received_at > ?
       ORDER BY received_at DESC LIMIT 500`
    ).bind(row.id, Date.now() - 30 * 86400000).all();

    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
    };
    // The dashboard is served from a different origin than the worker, so it
    // needs an explicit allow. It is named, never "*": the token sits in the
    // URL, so a wildcard would let any page the user visits read their whole
    // feed. Unset means no header at all, which fails closed - the dashboard
    // stops working until the var is set, rather than the feed quietly opening
    // to every origin the moment a deploy forgets it.
    if (env.DASHBOARD_ORIGIN) {
      headers["access-control-allow-origin"] = env.DASHBOARD_ORIGIN;
      headers["vary"] = "origin";
    }

    return new Response(JSON.stringify({ alerts: results }), { headers });
  },
};
