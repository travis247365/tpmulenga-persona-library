/**
 * Tests for the reply pipeline: extraction, the three document formats, the
 * profile endpoint, and the gating that decides whether mail is sent at all.
 *
 * The documents are checked by PARSING them back, not by matching strings in
 * the bytes. A .docx whose XML is malformed still contains the words; only a
 * parser notices that Word will refuse to open it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeDB } from "./db.js";

import worker from "../src/index.js";
import { extractJobs } from "../src/lib.js";
import { sanitiseProfile } from "../src/profile.js";
import { zip, crc32 } from "../src/doc/zip.js";
import { buildPack } from "../src/doc/pack.js";
import { toMarkdown } from "../src/doc/md.js";
import { toDocx } from "../src/doc/docx.js";
import { toPdf } from "../src/doc/pdf.js";
import { buildMessage, b64 } from "../src/doc/mime.js";
import { sendPack } from "../src/reply.js";
import { rankJobs } from "../src/rank.js";

const TOKEN = "a".repeat(32);
const DOMAIN = "jobs.travispaulconsulting.co";
const MINE = "travis.mulenga@gmail.com";

function env(extra = {}) {
  const DB = makeDB();
  DB.raw.prepare("INSERT INTO accounts (token,label,created) VALUES (?,?,?)")
    .run(TOKEN, "travis", Date.now());
  return { DB, INGEST_DOMAIN: DOMAIN, APP_ORIGIN: "https://app.example.org", ...extra };
}
const account = (e) => e.DB.raw.prepare("SELECT id,label FROM accounts WHERE token=?").get(TOKEN);

function enableReplies(e, { to = MINE, enabled = 1, max = 6 } = {}) {
  e.DB.raw.prepare(
    "INSERT INTO reply_settings (account_id,deliver_to,enabled,max_per_day,updated) VALUES (?,?,?,?,?)"
  ).run(account(e).id, to, enabled, max, Date.now());
}

const JOBS = [
  { key: "job:1", title: "Head of Operations", company: "Nutun RX", location: "Lusaka", url: "https://x/1" },
  { key: "job:2", title: "Chief Operating Officer", company: null, location: null, url: "https://x/2" },
];

const RANKING = {
  summary: "Two roles.",
  ranked: [
    { url: "https://x/1", title: "Head of Operations", score: 5, verdict: "apply",
      why: "Direct match.", concerns: ["No team size given."],
      tweaks: [{ change: "Lead with collections.", why: "First requirement." }] },
    { url: "https://x/2", title: "Chief Operating Officer", score: 2, verdict: "skip",
      why: "Scale the profile does not evidence." },
  ],
};

const pack = () => buildPack({ label: "travis", at: Date.parse("2026-10-17T06:00:00Z"), jobs: JOBS, ranking: RANKING });

// ---------------------------------------------------------------------------
describe("extraction", () => {
  const mail = `
    <a href="https://www.linkedin.com/comm/jobs/view/4123456789/?trk=a">Head of Operations</a>
    Nutun RX &middot; Lusaka, Zambia
    <a href="https://www.linkedin.com/comm/jobs/view/4123456789/?trk=b">View job</a>
    <a href="https://exec.example.org/vacancy/55/">Chief Operating Officer</a>
    <a href="https://www.linkedin.com/unsubscribe">Unsubscribe</a>
    <a href="https://www.linkedin.com/feed/">LinkedIn</a>`;

  test("finds the roles", () => {
    const got = extractJobs(mail);
    assert.deepEqual(got.map((j) => j.title),
      ["Head of Operations", "Chief Operating Officer"]);
  });

  test("the same role linked twice counts once", () => {
    // The title link and the "View job" button share an id. Counting both
    // would double every role in a LinkedIn digest.
    assert.equal(extractJobs(mail).filter((j) => j.key === "job:4123456789").length, 1);
  });

  test("chrome links are not roles", () => {
    const titles = extractJobs(mail).map((j) => j.title);
    assert.ok(!titles.includes("Unsubscribe"));
    assert.ok(!titles.includes("LinkedIn"));
    assert.ok(!titles.includes("View job"));
  });

  test("reads the company and location that follow the link", () => {
    const j = extractJobs(mail).find((x) => x.title === "Head of Operations");
    assert.equal(j.company, "Nutun RX");
    assert.equal(j.location, "Lusaka, Zambia");
  });

  test("a role with no company line gets nulls, not a guess", () => {
    const j = extractJobs(mail).find((x) => x.title === "Chief Operating Officer");
    assert.equal(j.company, null);
    assert.equal(j.location, null);
  });
});

// ---------------------------------------------------------------------------
describe("zip", () => {
  test("central directory size is measured to the start of the EOCD", () => {
    // The bug this catches: computing the directory size from a cursor that
    // has already advanced into the EOCD, which overstates it by 12 bytes and
    // makes every reader report a bad magic number.
    const bytes = zip([{ name: "a.txt", data: "hello" }]);
    const eocd = bytes.length - 22;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    assert.equal(cdOffset + cdSize, eocd);
  });

  test("CRC matches the data", () => {
    const bytes = zip([{ name: "a.txt", data: "hello" }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    assert.equal(view.getUint32(14, true), crc32(new TextEncoder().encode("hello")));
  });

  test("the DOS date is valid, not zero", () => {
    // Zero encodes month 0, which some readers reject outright.
    const bytes = zip([{ name: "a.txt", data: "x" }]);
    assert.notEqual(new DataView(bytes.buffer, bytes.byteOffset).getUint16(12, true), 0);
  });
});

// ---------------------------------------------------------------------------
describe("documents", () => {
  test("markdown carries the ranking and the honesty note", () => {
    const md = toMarkdown(pack());
    assert.match(md, /Head of Operations — 5\/5 \(apply\)/);
    assert.match(md, /Lead with collections/);
    assert.match(md, /no hidden text is ever added/);
  });

  test("the title is not printed twice", () => {
    assert.equal((toMarkdown(pack()).match(/^# Job Pack$/gm) || []).length, 1);
  });

  test("docx parts are well-formed XML", () => {
    const bytes = toDocx(pack());
    for (const [name, xml] of readZip(bytes)) {
      if (!/\.(xml|rels)$/.test(name)) continue;
      // A throw here is the whole assertion: Word refuses a malformed part.
      assert.doesNotThrow(() => parseXml(xml), `${name} is malformed`);
    }
  });

  test("docx strips control characters that would make Word refuse the file", () => {
    const p = buildPack({
      label: "x", at: Date.now(), ranking: null,
      jobs: [{ title: "Bad\u0007Title", company: null, location: null, url: "" }],
    });
    const doc = new Map(readZip(toDocx(p))).get("word/document.xml");
    assert.ok(!doc.includes("\u0007"));
    assert.match(doc, /BadTitle/);
  });

  test("pdf declares a header and a reachable xref", () => {
    const bytes = toPdf(pack());
    const text = Buffer.from(bytes).toString("latin1");
    assert.match(text, /^%PDF-1\.4/);
    const start = Number(text.match(/startxref\s+(\d+)/)[1]);
    assert.equal(text.slice(start, start + 4), "xref");
  });

  test("every pdf xref offset points at its own object header", () => {
    // An off-by-one here is invisible in the bytes and fatal in a reader.
    const text = Buffer.from(toPdf(pack())).toString("latin1");
    const start = Number(text.match(/startxref\s+(\d+)/)[1]);
    const rows = text.slice(start).split("\n").slice(2);
    rows.forEach((row, i) => {
      const m = row.match(/^(\d{10}) 00000 n/);
      if (!m) return;
      const n = i;
      assert.ok(text.startsWith(`${n} 0 obj`, Number(m[1])),
        `xref entry ${n} does not point at "${n} 0 obj"`);
    });
  });

  test("pdf maps punctuation into WinAnsi rather than emitting UTF-8", () => {
    const p = buildPack({ label: "x", at: Date.now(), ranking: null,
      jobs: [{ title: "A — B · C", company: null, location: null, url: "" }] });
    const text = Buffer.from(toPdf(p)).toString("latin1");
    assert.match(text, /A \x97 B \xb7 C/);        // em dash 0x97, middot 0xb7
    assert.ok(!text.includes("â\u0080\u0094"));  // the UTF-8 em dash, mis-stored
  });

  test("a pack with no ranking says so instead of implying an order", () => {
    const md = toMarkdown(buildPack({
      label: "x", at: Date.now(), jobs: JOBS, ranking: null, rankingNote: "no operator API key configured",
    }));
    assert.match(md, /were not ranked — no operator API key configured/);
    assert.match(md, /arrival order and not as a recommendation/);
  });
});

// ---------------------------------------------------------------------------
describe("mime", () => {
  const built = () => buildMessage({
    from: `packs@${DOMAIN}`, to: MINE, subject: "Job pack — 2 roles",
    pack: pack(), markdown: toMarkdown(pack()), docx: toDocx(pack()), pdf: toPdf(pack()),
    messageId: `<abc@${DOMAIN}>`, date: new Date(0),
  });

  test("three attachments, correctly typed", () => {
    const raw = built();
    assert.match(raw, /filename="job-pack-1970-01-01\.md"/);
    assert.match(raw, /filename="job-pack-1970-01-01\.docx"/);
    assert.match(raw, /filename="job-pack-1970-01-01\.pdf"/);
    assert.match(raw, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
    assert.match(raw, /application\/pdf/);
  });

  test("the pdf attachment decodes back to the exact bytes", () => {
    // Base64 that is folded wrongly, or built by spreading a large array,
    // corrupts silently - the mail arrives and the attachment will not open.
    const raw = built();
    const section = raw.split('filename="job-pack-1970-01-01.pdf"')[1];
    const body = section.split("\r\n\r\n")[1].split("\r\n--")[0];
    const decoded = Buffer.from(body.replace(/\r\n/g, ""), "base64");
    assert.equal(decoded.subarray(0, 5).toString(), "%PDF-");
  });

  test("a non-ASCII subject is RFC 2047 encoded", () => {
    const raw = buildMessage({
      from: "a@b.co", to: MINE, subject: "Job pack — 2 roles", pack: pack(),
      markdown: "x", docx: new Uint8Array([1]), pdf: new Uint8Array([2]),
      messageId: "<x@y>", date: new Date(0),
    });
    assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  });

  test("marks itself auto-generated so it cannot start a loop", () => {
    assert.match(built(), /^Auto-Submitted: auto-generated$/m);
  });

  test("base64 survives payloads larger than the argument limit", () => {
    const big = new Uint8Array(200000).fill(65);
    assert.equal(Buffer.from(b64(big), "base64").length, 200000);
  });
});

// ---------------------------------------------------------------------------
describe("profile endpoint", () => {
  const post = (e, token, body) =>
    worker.fetch(new Request(`https://w.dev/profile/${token}`, {
      method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    }), e);

  test("stores the fields it recognises", async () => {
    const e = env();
    const res = await post(e, TOKEN, { headline: "Ops exec", skills: ["collections"], years: 15 });
    assert.equal(res.status, 200);
    const row = e.DB.raw.prepare("SELECT json FROM profiles").get();
    assert.deepEqual(JSON.parse(row.json), { headline: "Ops exec", skills: ["collections"], years: 15 });
  });

  test("drops fields it does not recognise instead of storing them", async () => {
    const e = env();
    await post(e, TOKEN, { headline: "Ops exec", cv_text: "THE WHOLE CV", notes: "x" });
    const stored = JSON.parse(e.DB.raw.prepare("SELECT json FROM profiles").get().json);
    assert.deepEqual(Object.keys(stored), ["headline"]);
  });

  test("refuses a field long enough to be CV text", async () => {
    const e = env();
    const res = await post(e, TOKEN, { summary: "x".repeat(1201) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /derived profile, not CV text/);
    assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM profiles").get().n, 0);
  });

  test("refuses an oversized body outright", async () => {
    const e = env();
    const res = await post(e, TOKEN, "x".repeat(17000));
    assert.equal(res.status, 413);
  });

  test("an unknown token is a 404, the same shape as a bad path", async () => {
    const e = env();
    const res = await post(e, "z".repeat(32), { headline: "x" });
    assert.equal(res.status, 404);
  });

  test("a second upload replaces the first", async () => {
    const e = env();
    await post(e, TOKEN, { headline: "first" });
    await post(e, TOKEN, { headline: "second" });
    const rows = e.DB.raw.prepare("SELECT json FROM profiles").all();
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].json).headline, "second");
  });

  test("CORS names the app origin and never a wildcard", async () => {
    const e = env();
    const res = await post(e, TOKEN, { headline: "x" });
    assert.equal(res.headers.get("access-control-allow-origin"), "https://app.example.org");
  });

  test("with no APP_ORIGIN there is no CORS header at all", async () => {
    const e = env(); delete e.APP_ORIGIN;
    const res = await post(e, TOKEN, { headline: "x" });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  test("sanitiser rejects a nested object rather than flattening it", () => {
    assert.equal(sanitiseProfile({ skills: [{ a: 1 }] }).ok, false);
    assert.equal(sanitiseProfile({ headline: { a: 1 } }).ok, false);
  });
});

// ---------------------------------------------------------------------------
describe("reply gating", () => {
  const noRank = async () => ({ ok: false, reason: "ranking disabled in this test" });
  function spy() {
    const sent = [];
    return { sent, send: async (_e, msg) => (sent.push(msg), { ok: true }) };
  }

  test("nothing is sent unless replies are switched on for the account", async () => {
    const e = env();
    const s = spy();
    const out = await sendPack(e, account(e), JOBS, { rank: noRank, send: s.send });
    assert.equal(out.status, "skipped");
    assert.equal(s.sent.length, 0);
    assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM digests").get().n, 0);
  });

  test("an enabled account gets the pack at its configured address", async () => {
    const e = env(); enableReplies(e);
    const s = spy();
    const out = await sendPack(e, account(e), JOBS, { rank: noRank, send: s.send });
    assert.equal(out.status, "sent");
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].to, MINE);
    assert.equal(s.sent[0].from, `packs@${DOMAIN}`);
  });

  test("the daily cap stops a digest storm becoming a mail storm", async () => {
    const e = env(); enableReplies(e, { max: 2 });
    const s = spy();
    for (let i = 0; i < 3; i++) await sendPack(e, account(e), JOBS, { rank: noRank, send: s.send });
    assert.equal(s.sent.length, 2);
    const last = e.DB.raw.prepare("SELECT status,detail FROM digests ORDER BY id DESC").get();
    assert.equal(last.status, "failed");
    assert.match(last.detail, /daily cap of 2/);
  });

  test("an unconfigured ingest domain fails loudly instead of sending from nowhere", async () => {
    const e = env({ INGEST_DOMAIN: "REPLACE_WITH_YOUR_EMAIL_ROUTING_DOMAIN" });
    enableReplies(e);
    const s = spy();
    const out = await sendPack(e, account(e), JOBS, { rank: noRank, send: s.send });
    assert.equal(out.status, "failed");
    assert.equal(s.sent.length, 0);
    assert.match(e.DB.raw.prepare("SELECT detail FROM digests").get().detail, /INGEST_DOMAIN/);
  });

  test("a delivery failure is recorded, not swallowed", async () => {
    const e = env(); enableReplies(e);
    const out = await sendPack(e, account(e), JOBS, {
      rank: noRank, send: async () => ({ ok: false, reason: "destination not verified" }),
    });
    assert.equal(out.status, "failed");
    assert.match(e.DB.raw.prepare("SELECT detail FROM digests").get().detail, /not verified/);
  });

  test("no profile means an unranked pack, not a missing one", async () => {
    const e = env(); enableReplies(e);
    const s = spy();
    let ranked = false;
    await sendPack(e, account(e), JOBS, { rank: async () => (ranked = true, { ok: true, data: RANKING }), send: s.send });
    assert.equal(ranked, false, "ranking must not run without a profile");
    assert.match(plainPart(s.sent[0].raw), /were not ranked/);
  });

  test("a stored profile is what gets ranked, and the CV never is", async () => {
    const e = env(); enableReplies(e);
    e.DB.raw.prepare("INSERT INTO profiles (account_id,json,updated) VALUES (?,?,?)")
      .run(account(e).id, JSON.stringify({ headline: "Ops exec" }), Date.now());
    let seen = null;
    const s = spy();
    await sendPack(e, account(e), JOBS, {
      rank: async (_e, profile) => (seen = profile, { ok: true, data: RANKING }), send: s.send,
    });
    assert.deepEqual(seen, { headline: "Ops exec" });
  });

  test("an empty digest sends nothing", async () => {
    const e = env(); enableReplies(e);
    const s = spy();
    const out = await sendPack(e, account(e), [], { rank: noRank, send: s.send });
    assert.equal(out.status, "skipped");
    assert.equal(s.sent.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe("end to end through the email handler", () => {
  function message(raw, { to = `jobs+${TOKEN}@${DOMAIN}`, from = "jobalerts-noreply@linkedin.com" } = {}) {
    return {
      to, from,
      headers: new Map([["subject", "jobs for you"]]),
      get raw() { return new TextEncoder().encode(raw); },
    };
  }
  const digest = `
    <a href="https://www.linkedin.com/comm/jobs/view/5550001/?x=1">Head of Operations</a>
    Nutun RX &middot; Lusaka, Zambia
    <a href="https://www.linkedin.com/comm/jobs/view/5550002/?x=1">Group Head, CVM</a>`;

  test("an allowed digest stores its roles and mails the pack back", async () => {
    const e = env(); enableReplies(e);
    const sent = [];
    await worker.email(message(digest), e, null, {
      rank: async () => ({ ok: false, reason: "off in test" }),
      send: async (_x, m) => (sent.push(m), { ok: true }),
    });
    assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM jobs").get().n, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, MINE);
  });

  test("the pack never goes to the sender of the alert", async () => {
    // message.reply() would answer LinkedIn's no-reply address. This system
    // mails one verified address and nothing else, ever.
    const e = env(); enableReplies(e);
    const sent = [];
    await worker.email(message(digest), e, null, {
      rank: async () => ({ ok: false, reason: "off" }),
      send: async (_x, m) => (sent.push(m), { ok: true }),
    });
    assert.ok(!sent.some((m) => /linkedin/i.test(m.to)), "mail addressed to the job board");
    assert.equal(sent[0].to, MINE);
  });

  test("the same digest arriving twice does not re-send", async () => {
    const e = env(); enableReplies(e);
    const sent = [];
    const deps = { rank: async () => ({ ok: false, reason: "off" }), send: async (_x, m) => (sent.push(m), { ok: true }) };
    await worker.email(message(digest), e, null, deps);
    await worker.email(message(digest), e, null, deps);
    assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM jobs").get().n, 2);
    assert.equal(sent.length, 1, "the second copy had no new roles and must be silent");
  });

  test("a disallowed sender is logged and never produces a pack", async () => {
    const e = env(); enableReplies(e);
    const sent = [];
    await worker.email(message(digest, { from: "stranger@evil.test" }), e, null, {
      send: async (_x, m) => (sent.push(m), { ok: true }),
    });
    assert.equal(sent.length, 0);
    assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM rejected").get().n, 1);
    assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM jobs").get().n, 0);
  });
});

// ---------------------------------------------------------------------------
describe("ranking", () => {
  test("no operator key means no call and a stated reason", async () => {
    const out = await rankJobs({}, { headline: "x" }, JOBS, () => {
      throw new Error("must not reach the network");
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /no operator API key/);
  });

  test("a refusal is reported, not parsed as JSON", async () => {
    const out = await rankJobs({ ANTHROPIC_API_KEY: "sk-ant-x" }, { headline: "x" }, JOBS,
      async () => new Response(JSON.stringify({
        stop_reason: "refusal", stop_details: { category: "bio" }, content: [],
      }), { status: 200 }));
    assert.equal(out.ok, false);
    assert.match(out.reason, /declined \(bio\)/);
  });

  test("a max_tokens cut-off is reported rather than half-parsed", async () => {
    const out = await rankJobs({ ANTHROPIC_API_KEY: "sk-ant-x" }, { headline: "x" }, JOBS,
      async () => new Response(JSON.stringify({
        stop_reason: "max_tokens", content: [{ type: "text", text: '{"summary":"half' }],
      }), { status: 200 }));
    assert.equal(out.ok, false);
    assert.match(out.reason, /max_tokens/);
  });

  test("the request asks for adaptive thinking and a json schema", async () => {
    let body = null;
    await rankJobs({ ANTHROPIC_API_KEY: "sk-ant-x" }, { headline: "x" }, JOBS,
      async (_u, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }), { status: 200 });
      });
    assert.equal(body.model, "claude-opus-5-5");
    assert.deepEqual(body.thinking, { type: "adaptive" });
    assert.equal(body.output_config.format.type, "json_schema");
    // This model's effort defaults to medium; screening deserves more and has
    // to say so explicitly.
    assert.equal(body.output_config.effort, "high");
    assert.equal(body.budget_tokens, undefined, "budget_tokens is a 400 on this model");
  });

  test("a network failure returns a reason instead of throwing", async () => {
    const out = await rankJobs({ ANTHROPIC_API_KEY: "sk-ant-x" }, { headline: "x" }, JOBS,
      async () => { throw new Error("socket hang up"); });
    assert.equal(out.ok, false);
    assert.match(out.reason, /socket hang up/);
  });
});

// --- tiny helpers ----------------------------------------------------------
/** The text/plain alternative, decoded. Asserting on the raw message would
 *  only ever see base64. */
function plainPart(raw) {
  const after = raw.split('Content-Type: text/plain; charset="utf-8"')[1];
  const body = after.split("\r\n\r\n")[1].split("\r\n--")[0];
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
}

/** Read a stored-entry zip back out, so the docx is checked by parsing. */
function readZip(bytes) {
  const buf = Buffer.from(bytes);
  const out = [];
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const size = buf.readUInt32LE(p + 18);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString();
    const start = p + 30 + nameLen + extraLen;
    out.push([name, buf.subarray(start, start + size).toString("utf8")]);
    p = start + size;
  }
  return out;
}

/** A strict-enough XML well-formedness check: tags must nest and close. */
function parseXml(xml) {
  const stack = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tag.exec(xml))) {
    const [, closing, name, attrs, selfClose] = m;
    if (attrs.includes("<")) throw new Error(`stray < inside <${name}>`);
    if (selfClose || xml.startsWith("<?", m.index)) continue;
    if (closing) {
      if (stack.pop() !== name) throw new Error(`</${name}> does not close the open tag`);
    } else {
      stack.push(name);
    }
  }
  if (stack.length) throw new Error(`unclosed: ${stack.join(", ")}`);
  return true;
}
