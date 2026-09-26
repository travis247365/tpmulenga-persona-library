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
 * and only mail from senders on the allowlist is stored - a stranger who
 * guesses an address still cannot inject a fake role unless they can also forge
 * a known job-board sender past SPF and DKIM, which Email Routing checks before
 * this worker runs.
 */
import { isAllowedSender, senderAddress, decodeBody, jobIds, dedupKey } from "./lib.js";

export async function handleEmail(message, env) {
  const to = String(message.to || "").toLowerCase();
  const from = senderAddress(message.from);

  const token = (to.match(/\+([a-z0-9]{24,})@/) || [])[1];
  if (!token) return;                       // not an ingest address; drop silently

  const account = await env.DB.prepare(
    "SELECT id FROM accounts WHERE token = ?"
  ).bind(token).first();
  if (!account) return;                     // unknown token; drop silently

  const subject = message.headers.get("subject") || "";

  if (!isAllowedSender(from)) {
    await env.DB.prepare(
      "INSERT INTO rejected (account_id, sender, subject, at) VALUES (?,?,?,?)"
    ).bind(account.id, from, subject, Date.now()).run();
    return;
  }

  const decoded = decodeBody(await new Response(message.raw).text());
  const ids = jobIds(decoded);
  const at = Date.now();

  // No job ids means a non-digest alert; keep the thread itself so the volume
  // figures stay honest rather than silently dropping it. It still gets a
  // dedup key, so a re-send within the day does not double-count.
  const rows = ids.length ? ids : [null];
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO alerts
       (account_id, job_id, dedup_key, subject, sender, received_at)
     VALUES (?,?,?,?,?,?)`
  );
  const bound = [];
  for (const id of rows) {
    const key = await dedupKey({ jobId: id, sender: from, subject, at });
    bound.push(stmt.bind(account.id, id, key, subject, from, at));
  }
  await env.DB.batch(bound);
}

export default { email: handleEmail };
