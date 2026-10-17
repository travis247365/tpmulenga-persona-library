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
import { isAllowedSender, senderAddress, decodeBody, jobIds, dedupKey, extractJobs } from "./lib.js";
import { sendPack } from "./reply.js";

export async function handleEmail(message, env, ctx, deps = {}) {
  const to = String(message.to || "").toLowerCase();
  const from = senderAddress(message.from);

  const token = (to.match(/\+([a-z0-9]{24,})@/) || [])[1];
  if (!token) return;                       // not an ingest address; drop silently

  const account = await env.DB.prepare(
    "SELECT id, label FROM accounts WHERE token = ?"
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

  // The roles themselves, as opposed to the fact that a digest arrived.
  // Ranking needs titles: fifteen ids and one subject line is not something
  // anyone can screen against.
  const fresh = await storeJobs(env, account.id, extractJobs(decoded), from, at);

  // Only the roles that are new to this account go into the pack. Re-sending
  // yesterday's shortlist because the same digest arrived twice is the fastest
  // way to make someone stop reading these.
  return sendPack(env, account, fresh, deps);
}

/**
 * Insert the extracted roles, and return the ones that were genuinely new.
 *
 * INSERT OR IGNORE cannot tell us which rows it ignored through D1's batch
 * interface, so the existing keys are read first and the difference is taken
 * here. Doing it the other way round - insert, then select everything from
 * today - would re-send a role that merely arrived again.
 */
async function storeJobs(env, accountId, found, source, at) {
  if (!found.length) return [];

  const placeholders = found.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT dedup_key FROM jobs WHERE account_id = ? AND dedup_key IN (${placeholders})`
  ).bind(accountId, ...found.map((j) => j.key)).all();
  const known = new Set((results || []).map((r) => r.dedup_key));

  const fresh = found.filter((j) => !known.has(j.key));
  if (!fresh.length) return [];

  const ins = env.DB.prepare(
    `INSERT OR IGNORE INTO jobs
       (account_id, dedup_key, title, company, location, url, source, found_at)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  await env.DB.batch(fresh.map((j) =>
    ins.bind(accountId, j.key, j.title, j.company, j.location, j.url, source, at)));

  return fresh;
}

export default { email: handleEmail };
