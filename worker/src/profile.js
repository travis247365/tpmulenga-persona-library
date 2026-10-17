/**
 * Accept the derived profile the app computes in the browser.
 *
 * What this endpoint must never receive is the CV. The app derives titles,
 * skills, seniority and years from it locally and uploads only that, and only
 * when the user presses the button. So the check here is not cosmetic: an
 * oversized body, or one carrying a field that looks like CV text, is
 * refused rather than stored. The app's privacy claim is only as good as the
 * narrowest thing this endpoint will accept.
 */
const MAX_BYTES = 16 * 1024;

/** Fields we store. Anything else in the body is dropped, not saved. */
const ALLOWED = new Set([
  "headline", "seniority", "years", "titles", "skills", "sectors",
  "locations", "languages", "certifications", "summary", "avoid",
]);

const STRING_CAPS = { headline: 200, seniority: 60, summary: 1200 };
const LIST_CAP = 40, ITEM_CAP = 120;

export function sanitiseProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "the profile must be a JSON object" };
  }
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED.has(k)) continue;                    // silently dropped, never stored
    if (typeof v === "number" && Number.isFinite(v)) { out[k] = v; continue; }
    if (typeof v === "string") {
      const cap = STRING_CAPS[k] || ITEM_CAP;
      if (v.length > cap) {
        return { ok: false, reason: `"${k}" is longer than ${cap} characters — this endpoint takes a derived profile, not CV text` };
      }
      out[k] = v.trim();
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length > LIST_CAP) return { ok: false, reason: `"${k}" has more than ${LIST_CAP} entries` };
      const items = [];
      for (const item of v) {
        if (typeof item !== "string") return { ok: false, reason: `"${k}" must be a list of strings` };
        if (item.length > ITEM_CAP) {
          return { ok: false, reason: `an entry in "${k}" is longer than ${ITEM_CAP} characters — this endpoint takes a derived profile, not CV text` };
        }
        items.push(item.trim());
      }
      out[k] = items;
      continue;
    }
    return { ok: false, reason: `"${k}" must be a string, a number or a list of strings` };
  }
  if (!Object.keys(out).length) {
    return { ok: false, reason: "the profile had none of the expected fields" };
  }
  return { ok: true, profile: out };
}

export async function handleProfile(request, env, token) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const account = await env.DB.prepare(
    "SELECT id FROM accounts WHERE token = ?"
  ).bind(token).first();
  // Same 404 shape as an unknown path: whether a token exists is not
  // something this endpoint should confirm to someone guessing.
  if (!account) return json({ error: "not found" }, 404);

  const raw = await request.text();
  if (raw.length > MAX_BYTES) {
    return json({ error: `profile too large (${raw.length} bytes, limit ${MAX_BYTES})` }, 413);
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return json({ error: `not valid JSON: ${e.message}` }, 400); }

  const clean = sanitiseProfile(parsed);
  if (!clean.ok) return json({ error: clean.reason }, 400);

  await env.DB.prepare(
    `INSERT INTO profiles (account_id, json, updated) VALUES (?,?,?)
     ON CONFLICT(account_id) DO UPDATE SET json = excluded.json, updated = excluded.updated`
  ).bind(account.id, JSON.stringify(clean.profile), Date.now()).run();

  return json({ stored: Object.keys(clean.profile) }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
