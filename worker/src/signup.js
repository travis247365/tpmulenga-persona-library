/**
 * Self-service account creation.
 *
 * This is what makes the thing scalable rather than a single-user script: a
 * visitor presses one button, gets a forwarding address, adds one filter in
 * whatever mail client they already use, and their feed starts filling. No
 * OAuth consent screen, no Google verification, no per-user setup by hand.
 *
 * What we are NOT doing, deliberately: no password, no email confirmation, no
 * account recovery. The token is the account. That is an honest trade for a
 * feed of public job adverts - there is nothing here worth phishing - and it
 * means we never hold a credential that could be reused anywhere else. The
 * cost is that a lost token is a lost feed, which the UI says plainly.
 */
const SIGNUPS_PER_IP_PER_DAY = 5;
const DAY = 86400000;

/** 32 lowercase base36 characters from the CSPRNG: ~165 bits. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Is the ingest domain real, or still a placeholder?
 *
 * Getting this wrong is silent, which is what makes it worth a check. An
 * account created against an unconfigured domain hands someone
 * jobs+<token>@REPLACE_WITH_YOUR_EMAIL_ROUTING_DOMAIN, the signup reports
 * success, they add a mail filter forwarding to it, and nothing ever arrives.
 * They have no way to tell that from "no jobs matched this week".
 */
export function ingestDomain(env) {
  const d = String(env.INGEST_DOMAIN || "").trim().toLowerCase();
  if (!d) return null;
  if (d.startsWith("replace")) return null;          // the shipped placeholder
  if (d.endsWith(".invalid") || d.endsWith(".example")) return null;
  if (d === "example.com" || d === "localhost") return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;   // not a hostname
  return d;
}

export async function handleSignup(request, env) {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // Refuse rather than mint an address that cannot receive mail. 503, because
  // this is the operator's configuration missing, not the caller's fault.
  const domain = ingestDomain(env);
  if (!domain) {
    return json({
      error: "The job feed is not switched on for this site yet — its mail " +
             "domain has not been configured. Nothing was created.",
    }, 503);
  }

  // Creating a row costs us nothing and costs the caller nothing, which is
  // exactly the shape of thing that gets scripted. A per-IP cap keeps a bored
  // afternoon from filling the table, without putting a CAPTCHA in front of a
  // one-button flow.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const since = Date.now() - DAY;
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM signups WHERE ip = ? AND at > ?"
  ).bind(ip, since).first();
  if (recent && recent.n >= SIGNUPS_PER_IP_PER_DAY) {
    return json({ error: "Too many feeds created from here today. Try tomorrow." }, 429);
  }

  let label = "";
  try {
    label = String((await request.json())?.label || "").slice(0, 60);
  } catch {
    label = "";                              // a body is optional
  }

  const token = newToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO accounts (token, label, created) VALUES (?,?,?)")
      .bind(token, label, Date.now()),
    env.DB.prepare("INSERT INTO signups (ip, at) VALUES (?,?)").bind(ip, Date.now()),
  ]);

  return json({
    token,
    address: `jobs+${token}@${domain}`,
    feed: `/feed/${token}`,
  }, 201);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
