/**
 * The one place mail leaves this worker.
 *
 * It goes through the send_email binding, NOT message.reply(). That is a
 * deliberate choice with two consequences, both wanted:
 *
 *   1. reply() answers the From of the incoming mail - which, on a forwarded
 *      job alert, is LinkedIn's no-reply address. Replying would send the
 *      pack to a job board.
 *   2. The binding only accepts destinations verified in Cloudflare Email
 *      Routing, and wrangler.toml pins it to one address. "This system can
 *      only mail an address its owner verified" is then enforced by the
 *      platform rather than promised by a line of code someone can edit.
 */
export async function deliver(env, { from, to, raw }, EmailMessageCtor) {
  if (!env.SEND) return { ok: false, reason: "no SEND binding on this worker" };
  // cloudflare:email exists only in the Workers runtime. Importing it at
  // module scope would make this file unloadable under node:test, so it is
  // pulled in on first use and the tests inject their own constructor.
  const Ctor = EmailMessageCtor || (await import("cloudflare:email")).EmailMessage;
  try {
    await env.SEND.send(new Ctor(from, to, raw));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  }
}
