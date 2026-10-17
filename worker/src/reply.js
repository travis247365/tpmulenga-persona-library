/**
 * Turn a freshly-ingested digest into a pack and mail it back.
 *
 * Every exit writes a row to `digests`. A run that sent nothing is a failed
 * run whatever the platform reports, and the only way that stays true is if
 * the failure is recorded somewhere that outlives a log line.
 */
import { rankJobs } from "./rank.js";
import { buildPack } from "./doc/pack.js";
import { toMarkdown } from "./doc/md.js";
import { toDocx } from "./doc/docx.js";
import { toPdf } from "./doc/pdf.js";
import { buildMessage } from "./doc/mime.js";
import { deliver } from "./deliver.js";
import { ingestDomain } from "./signup.js";

const DAY = 86400000;

async function record(env, accountId, at, jobCount, status, detail) {
  await env.DB.prepare(
    "INSERT INTO digests (account_id, at, job_count, status, detail) VALUES (?,?,?,?,?)"
  ).bind(accountId, at, jobCount, status, detail || null).run();
  return { status, detail };
}

/**
 * @param {object} deps  test seam: {rank, send, now, EmailMessage}
 */
export async function sendPack(env, account, jobs, deps = {}) {
  const now = deps.now || Date.now();
  const rank = deps.rank || rankJobs;
  const send = deps.send || deliver;

  const settings = await env.DB.prepare(
    "SELECT deliver_to, enabled, max_per_day FROM reply_settings WHERE account_id = ?"
  ).bind(account.id).first();

  // Off unless switched on. A public signup never causes mail to be sent.
  if (!settings || !settings.enabled) return { status: "skipped", detail: "replies not enabled" };
  if (!settings.deliver_to) {
    return record(env, account.id, now, jobs.length, "failed", "no delivery address set");
  }
  if (!jobs.length) return { status: "skipped", detail: "no new roles in this mail" };

  const domain = ingestDomain(env);
  if (!domain) {
    return record(env, account.id, now, jobs.length, "failed",
      "INGEST_DOMAIN is not configured, so there is no address to send from");
  }

  // A digest storm must not become a mail storm.
  const sentToday = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM digests WHERE account_id = ? AND at > ? AND status = 'sent'"
  ).bind(account.id, now - DAY).first();
  const cap = settings.max_per_day || 6;
  if (sentToday && sentToday.n >= cap) {
    return record(env, account.id, now, jobs.length, "failed",
      `daily cap of ${cap} packs already reached`);
  }

  const profileRow = await env.DB.prepare(
    "SELECT json FROM profiles WHERE account_id = ?"
  ).bind(account.id).first();

  let profile = null;
  if (profileRow) {
    try { profile = JSON.parse(profileRow.json); } catch { profile = null; }
  }

  let ranking = null;
  let rankingNote = profile
    ? null
    : "no profile has been uploaded yet, so there was nothing to rank against";
  if (profile) {
    const r = await rank(env, profile, jobs);
    if (r.ok) ranking = r.data;
    else rankingNote = r.reason;
  }

  const pack = buildPack({ label: account.label, at: now, jobs, ranking, rankingNote });
  const markdown = toMarkdown(pack);
  const docx = toDocx(pack);
  const pdf = toPdf(pack);

  const top = ranking && ranking.ranked && ranking.ranked.filter((r) => r.score >= 4).length;
  const subject = top
    ? `Job pack — ${top} worth applying for, ${jobs.length} in total`
    : `Job pack — ${jobs.length} role${jobs.length === 1 ? "" : "s"}`;

  const raw = buildMessage({
    from: `packs@${domain}`,
    to: settings.deliver_to,
    subject,
    pack,
    markdown,
    docx,
    pdf,
    messageId: `<${crypto.randomUUID()}@${domain}>`,
    date: new Date(now),
  });

  const sent = await send(env, {
    from: `packs@${domain}`, to: settings.deliver_to, raw,
  }, deps.EmailMessage);

  return sent.ok
    ? record(env, account.id, now, jobs.length, "sent",
        ranking ? "ranked" : `unranked: ${rankingNote}`)
    : record(env, account.id, now, jobs.length, "failed", sent.reason);
}
