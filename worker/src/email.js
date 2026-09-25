/**
 * Inbound job-alert ingest, without OAuth.
 *
 * The user creates ONE filter in their mail client that forwards job alerts to
 * jobs+<token>@<domain>. Cloudflare Email Routing delivers it here. No Google
 * scope is requested, so none of the restricted-scope machinery applies: no
 * consent screen, no CASA assessment, no 100-user cap. It also works for
 * Outlook, Yahoo and anything else that can forward, and the user revokes it by
 * deleting their filter rather than by trusting us to honour a revocation.
 *
 * The trade this makes: an address is a bearer credential. Anyone who learns it
 * can post alerts into that account's feed. So the token is long and random,
 * and only mail from senders on ALLOWED_SENDERS is stored - a stranger who
 * guesses an address still cannot inject a fake role unless they can also forge
 * a known job-board sender past SPF and DKIM, which Email Routing checks before
 * this worker runs.
 */

const ALLOWED_SENDERS = [
  "jobalerts-noreply@linkedin.com",
  "jobs-noreply@linkedin.com",
  "info@executiveplacements.com",
  "talentcommunity@connectedcareers.services.global.ntt",
];

// One alert email carries several roles. LinkedIn digests name each with a
// /jobs/view/<id> link, which is also the only stable per-role identifier we
// get - so it doubles as the dedup key.
const JOB_ID = /linkedin\.com\/comm\/jobs\/view\/(\d{6,})/g;

export default {
  async email(message, env) {
    const to = String(message.to || "").toLowerCase();
    const from = String(message.from || "").toLowerCase();

    const token = (to.match(/\+([a-z0-9]{24,})@/) || [])[1];
    if (!token) return;                       // not an ingest address; drop silently

    const account = await env.DB.prepare(
      "SELECT id FROM accounts WHERE token = ?"
    ).bind(token).first();
    if (!account) return;                     // unknown token; drop silently

    if (!ALLOWED_SENDERS.some((s) => from.includes(s))) {
      await env.DB.prepare(
        "INSERT INTO rejected (account_id, sender, subject, at) VALUES (?,?,?,?)"
      ).bind(account.id, from, message.headers.get("subject") || "", Date.now()).run();
      return;
    }

    const raw = await new Response(message.raw).text();
    const subject = message.headers.get("subject") || "";
    const ids = [...new Set([...raw.matchAll(JOB_ID)].map((m) => m[1]))];

    // No job ids means a non-digest alert; keep the thread itself so the
    // volume figures stay honest rather than silently dropping it.
    const rows = ids.length ? ids : [null];
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO alerts (account_id, job_id, subject, sender, received_at)
       VALUES (?,?,?,?,?)`
    );
    await env.DB.batch(
      rows.map((id) => stmt.bind(account.id, id, subject, from, Date.now()))
    );
  },
};
