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

/**
 * Pull individual roles out of a digest.
 *
 * `jobIds` above answers "how many roles arrived"; it cannot answer "is this
 * one worth applying for", because an id is not a title. Ranking needs the
 * title, and ideally the company and location, so this walks the anchors.
 *
 * It is deliberately permissive about the shape of the mail and strict about
 * what counts as a role: every alert format differs, every one of them wraps
 * its links in tracking redirects, and all of them carry chrome links
 * (unsubscribe, view in browser, app store badges) that must not become jobs.
 */
const JOB_LINK = /(jobs?\/view|\/job\/|jobid=|job_id=|\/vacancy|\/vacancies|jobs?\/\d|\/careers?\/)/i;
const CHROME = /^(view|open|see|read|click|here|unsubscribe|manage|settings|privacy|terms|help|apply|view job|see all|view all|more jobs|download|app store|google play|linkedin|sign in|log in)\b/i;

/** Collapse entities and tags to readable text. */
const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  // The separator entities matter more than they look: LinkedIn writes
  // "Company &middot; Location", and leaving &middot; undecoded means the
  // company/location split never fires and every role is stored with nulls.
  middot: "\u00b7", bull: "\u2022", ndash: "\u2013", mdash: "\u2014",
  hellip: "\u2026", rsquo: "\u2019", lsquo: "\u2018",
  ldquo: "\u201c", rdquo: "\u201d", reg: "\u00ae", trade: "\u2122",
};

function unhtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    })
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Acme Ltd · Lusaka, Zambia" and its many punctuation variants.
 * Returns {company, location}, either of which may be null - a guess that is
 * wrong is worse than a blank, because the ranker quotes these back.
 */
function companyAndLocation(snippet) {
  // Stop at the next link. unhtml collapses newlines to spaces, so without
  // this the following anchor's text is swallowed and the location comes out
  // as "Lusaka, Zambia View job".
  let cut = String(snippet).split(/<a\b/i)[0];
  // Block ends are real line breaks; keep them so "first line" means something.
  cut = cut
    .replace(/<br[^>]*>/gi, "\n")
    .replace(/<\/(p|div|td|tr|li|h\d)>/gi, "\n");

  const line = cut.split("\n").map(unhtml).find((l) => l.length > 1) || "";
  const m = line.slice(0, 160).match(/^([^·•|]{2,60}?)\s*[·•|]\s*([^·•|]{2,60})$/);
  if (m) return { company: m[1].trim(), location: m[2].trim() };
  return { company: null, location: null };
}

export function extractJobs(decoded) {
  const text = String(decoded);
  const out = [];
  const seen = new Set();

  const anchors = text.matchAll(/<a\b[^>]*href=["']?([^"'\s>]+)[^>]*>([\s\S]{0,400}?)<\/a>/gi);
  for (const a of anchors) {
    const url = a[1];
    const title = unhtml(a[2]);
    if (!JOB_LINK.test(url)) continue;
    if (!title || title.length < 3 || title.length > 140) continue;
    if (CHROME.test(title)) continue;
    if (!/[a-z]/i.test(title)) continue;

    // The company and location usually sit in the text just after the link.
    const after = text.slice(a.index + a[0].length, a.index + a[0].length + 300);
    const { company, location } = companyAndLocation(after);

    // Dedup within one mail on the id where the URL carries one, and on the
    // title otherwise. Two links to the same role - the title and a "view"
    // button - must not count twice.
    const id = (url.match(/(?:jobs?\/view\/|jobid=|job_id=)(\d{4,})/i) || [])[1];
    const key = id ? `job:${id}` : `title:${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ key, title, company, location, url });
  }
  return out;
}
