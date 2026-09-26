/**
 * Read-only feed for the dashboard.
 *
 * The token in the path IS the credential, so the lookup must not leak whether
 * a given token exists. `SELECT ... WHERE token = ?` followed by a constant-time
 * compare of the row against the same value it was selected by is theatre: the
 * comparison can only ever succeed, and the timing signal lives in the indexed
 * lookup, which we do not control. So the check here is simply "did the lookup
 * return a row", and both outcomes return the same 404 body, which is what
 * actually denies an attacker a distinguisher.
 */
export async function handleFetch(request, env) {
  const url = new URL(request.url);
  const notFound = () => new Response("not found", { status: 404 });

  const m = url.pathname.match(/^\/feed\/([a-z0-9]{24,})$/);
  if (!m) return notFound();

  const row = await env.DB.prepare(
    "SELECT id FROM accounts WHERE token = ?"
  ).bind(m[1]).first();
  if (!row) return notFound();              // same shape as a bad path

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
}

export default { fetch: handleFetch };
