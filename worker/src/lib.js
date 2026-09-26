/**
 * Shared helpers for the ingest worker.
 */

/**
 * The exact addresses an alert may come from.
 *
 * Matched exactly, never by substring. A substring test accepts
 * `jobalerts-noreply@linkedin.com.evil.tld`, which is a domain an attacker can
 * register and pass SPF and DKIM on, so the mail arrives fully authenticated
 * and Email Routing has no reason to reject it. That single `includes` undid
 * the whole point of having an allowlist.
 */
export const ALLOWED_SENDERS = new Set([
  "jobalerts-noreply@linkedin.com",
  "jobs-noreply@linkedin.com",
  "info@executiveplacements.com",
  "talentcommunity@connectedcareers.services.global.ntt",
]);

/** Pull the bare address out of a From header, which may be "Name <a@b>". */
export function senderAddress(from) {
  const s = String(from || "").trim().toLowerCase();
  const angled = s.match(/<([^>]+)>/);
  return (angled ? angled[1] : s).trim();
}

export const isAllowedSender = (from) => ALLOWED_SENDERS.has(senderAddress(from));

/**
 * Decode a raw MIME message enough to find links in it.
 *
 * Alert mail is quoted-printable far more often than not, and a URL that wraps
 * across a line arrives as `...jobs/vie=\r\nw/12345`. Matching the raw bytes
 * therefore misses most job ids, and a digest whose ids all go missing is
 * stored with job_id NULL - which the partial unique index does not cover, so
 * the same digest re-sent tomorrow is counted again as new.
 */
export function decodeBody(raw) {
  const text = String(raw);
  const parts = [];

  // Walk each part, honouring its own transfer encoding. A single-part message
  // has no boundary, so treat the whole thing as one part.
  const chunks = text.split(/\r?\n--[-\w]+/);
  for (const chunk of chunks) {
    const split = chunk.search(/\r?\n\r?\n/);
    const head = split === -1 ? "" : chunk.slice(0, split);
    const body = split === -1 ? chunk : chunk.slice(split);
    const enc = (head.match(/content-transfer-encoding:\s*(\S+)/i) || [])[1];

    if (/base64/i.test(enc || "")) {
      try {
        parts.push(atob(body.replace(/\s+/g, "")));
      } catch {
        parts.push(body);          // not valid base64; keep the raw text
      }
    } else if (/quoted-printable/i.test(enc || "")) {
      parts.push(
        body
          .replace(/=\r?\n/g, "")                                  // soft breaks
          .replace(/=([0-9A-F]{2})/gi, (_, h) =>
            String.fromCharCode(parseInt(h, 16)))
      );
    } else {
      parts.push(body);
    }
  }
  // Also keep the raw text: a malformed part should never lose us an id we
  // could otherwise have seen.
  return parts.join("\n") + "\n" + text;
}

// One alert carries several roles. LinkedIn names each with a /jobs/view/<id>
// link, which is the only stable per-role identifier available, so it doubles
// as the dedup key.
const JOB_ID = /linkedin\.com\/comm\/jobs\/view\/(\d{6,})/g;

export function jobIds(decoded) {
  return [...new Set([...decoded.matchAll(JOB_ID)].map((m) => m[1]))];
}

/**
 * A dedup key that is never null.
 *
 * job_id when there is one. Otherwise the sender, subject and calendar day,
 * hashed - so a non-digest alert re-sent within the same day is recognised,
 * while the same alert genuinely re-sent next week is treated as new. Rows
 * with a NULL key escaped the partial unique index entirely, which is how
 * repeats got in.
 */
export async function dedupKey({ jobId, sender, subject, at }) {
  if (jobId) return `job:${jobId}`;
  const day = new Date(at).toISOString().slice(0, 10);
  const material = `${sender}|${subject}|${day}`;
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return `alert:${hex.slice(0, 32)}`;
}
