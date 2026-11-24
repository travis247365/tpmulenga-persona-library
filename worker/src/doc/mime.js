/**
 * Build the outbound message by hand.
 *
 * There is no mail library in the Workers runtime, and the send_email binding
 * takes a raw RFC 5322 message, so the envelope, the multipart structure and
 * the base64 attachments are all assembled here.
 *
 * Structure, which matters because mail clients are unforgiving:
 *
 *   multipart/mixed
 *     multipart/alternative
 *       text/plain          <- the markdown, readable as-is
 *       text/html           <- TPCL-branded
 *     application/...       <- .md, .docx, .pdf
 */

/** Base64 for arbitrary bytes, chunked: spreading a 100KB array into
 *  String.fromCharCode overflows the argument limit and throws. */
export function b64(bytes) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** 76-column lines, as the transfer encoding requires. */
const fold = (s) => (s.match(/.{1,76}/g) || []).join("\r\n");

/**
 * RFC 2047 for a Subject that may carry an em dash or an accented company
 * name. Raw UTF-8 in a header is not legal and some clients show mojibake.
 */
function encodeHeader(s) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${b64(s)}?=`;
}

const CHARCOAL = "#3A3A3A", AMBER = "#FFC107", SLATE = "#6B6B6B";

/** The HTML half. Table-based and inline-styled, because mail clients strip
 *  <style> blocks and have no flexbox worth relying on. */
function htmlBody(pack, counts) {
  const esc = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = pack.blocks.map((b) => {
    switch (b.t) {
      case "h2": return `<tr><td style="padding:22px 0 6px"><div style="font:700 15px/1.3 Poppins,Trebuchet MS,Arial,sans-serif;color:${CHARCOAL}">${esc(b.text)}</div></td></tr>`;
      case "h3": return `<tr><td style="padding:14px 0 2px"><div style="font:700 13px/1.35 Poppins,Trebuchet MS,Arial,sans-serif;color:${CHARCOAL}">${esc(b.text)}</div></td></tr>`;
      case "p":  return `<tr><td style="padding:0 0 8px"><div style="font:400 13px/1.55 Poppins,Trebuchet MS,Arial,sans-serif;color:${CHARCOAL}">${esc(b.text)}</div></td></tr>`;
      case "small": return `<tr><td style="padding:0 0 4px"><div style="font:400 11px/1.4 Poppins,Trebuchet MS,Arial,sans-serif;color:${SLATE}">${esc(b.text)}</div></td></tr>`;
      case "ul": return `<tr><td style="padding:0 0 8px"><ul style="margin:0;padding-left:18px">${
        b.items.map((i) => `<li style="font:400 13px/1.5 Poppins,Trebuchet MS,Arial,sans-serif;color:${CHARCOAL};margin:0 0 4px">${esc(i)}</li>`).join("")
      }</ul></td></tr>`;
      case "kv": return b.items.map((i) => `<tr><td style="padding:0 0 2px"><div style="font:400 11px/1.4 Poppins,Trebuchet MS,Arial,sans-serif;color:${SLATE}">${esc(i.k)}: ${esc(i.v)}</div></td></tr>`).join("");
      case "rule": return `<tr><td style="padding:14px 0"><div style="height:2px;background:${AMBER};line-height:2px;font-size:0">&nbsp;</div></td></tr>`;
      default: return "";
    }
  }).join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#FFFFFF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF">
<tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td style="padding:0 0 14px"><div style="width:44px;height:10px;background:${AMBER};line-height:10px;font-size:0">&nbsp;</div></td></tr>
<tr><td><div style="font:700 28px/1.1 Poppins,Trebuchet MS,Arial,sans-serif;color:${CHARCOAL};letter-spacing:-.02em">${esc(pack.title)}</div></td></tr>
<tr><td style="padding:4px 0 10px"><div style="font:400 12px/1.4 Poppins,Trebuchet MS,Arial,sans-serif;color:${SLATE}">${esc(pack.subtitle)}</div></td></tr>
${rows}
<tr><td style="padding:22px 0 0;border-top:2px solid ${CHARCOAL}">
<div style="font:400 11px/1.5 Poppins,Trebuchet MS,Arial,sans-serif;color:${SLATE}">
Attached: the same pack as Markdown, Word and PDF (${counts}). Your CV was not uploaded and is not stored — only a profile derived from it in your browser.
</div></td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * @returns {string} a complete RFC 5322 message
 */
export function buildMessage({ from, to, subject, pack, markdown, docx, pdf, messageId, date = new Date() }) {
  const mixed = `mixed_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const alt = `alt_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const stamp = date.toUTCString().replace("GMT", "+0000");
  const base = `job-pack-${date.toISOString().slice(0, 10)}`;

  const attach = (name, type, data) => [
    `--${mixed}`,
    `Content-Type: ${type}; name="${name}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${name}"`,
    "",
    fold(b64(data)),
    "",
  ].join("\r\n");

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Message-ID: ${messageId}`,
    `Date: ${stamp}`,
    "MIME-Version: 1.0",
    // Mail from an automated system: this stops a vacation responder or an
    // out-of-office from replying to it and starting a loop.
    "Auto-Submitted: auto-generated",
    "X-Auto-Response-Suppress: All",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    fold(b64(markdown)),
    "",
    `--${alt}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    fold(b64(htmlBody(pack, "3 files"))),
    "",
    `--${alt}--`,
    "",
    attach(`${base}.md`, "text/markdown", markdown),
    attach(`${base}.docx`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx),
    attach(`${base}.pdf`, "application/pdf", pdf),
    `--${mixed}--`,
    "",
  ].join("\r\n");
}
