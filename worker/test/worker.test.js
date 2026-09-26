/**
 * Worker tests, run on node's built-in runner: `node --test worker/test`.
 *
 * D1 is stubbed rather than mocked loosely. The stub executes real SQL against
 * node:sqlite using worker/schema.sql, so the partial unique index that does
 * the deduplication is the actual index the worker will meet in production -
 * a hand-rolled mock would have let the dedup test pass while the index was
 * wrong, which is the one thing these tests exist to catch.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import worker from "../src/index.js";
const emailWorker = worker;
const apiWorker = worker;

assert.ok(globalThis.crypto?.subtle, "these tests need WebCrypto (node 18+)");

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, "..", "schema.sql"), "utf8");

const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);

/** Minimal D1 surface: prepare().bind().first()/run()/all(), and batch(). */
function makeDB() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const prepare = (sql) => {
    const stmt = db.prepare(sql);
    const bound = (...args) => ({
      first: async () => stmt.get(...args) ?? null,
      run: async () => (stmt.run(...args), { success: true }),
      all: async () => ({ results: stmt.all(...args) }),
      // batch() replays the statement each time it was bound, so binding must
      // return a fresh object rather than mutate shared state.
      __exec: () => stmt.run(...args),
    });
    return { bind: bound };
  };
  return {
    raw: db,
    prepare,
    batch: async (stmts) => stmts.map((s) => s.__exec()),
  };
}

function makeEnv() {
  const DB = makeDB();
  DB.raw.prepare("INSERT INTO accounts (token,label,created) VALUES (?,?,?)")
    .run(TOKEN_A, "travis", Date.now());
  DB.raw.prepare("INSERT INTO accounts (token,label,created) VALUES (?,?,?)")
    .run(TOKEN_B, "other", Date.now());
  return { DB };
}

/** A LinkedIn-shaped digest carrying `ids` roles. */
function digest(ids) {
  const body = ids
    .map((id) => `<a href="https://www.linkedin.com/comm/jobs/view/${id}/?trk=x">Role ${id}</a>`)
    .join("\n");
  return `From: LinkedIn Job Alerts\r\nSubject: jobs for you\r\n\r\n${body}`;
}

function message({ to, from, subject = "jobs for you", raw = digest(["101010101"]) }) {
  return {
    to,
    from,
    raw: new TextEncoder().encode(raw),
    headers: new Map([["subject", subject]]),
  };
}
// message.headers must expose .get(), which Map already does.

const rows = (env, sql, ...a) => env.DB.raw.prepare(sql).all(...a);

describe("email worker", () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  test("three roles from one digest -> three rows", async () => {
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "jobalerts-noreply@linkedin.com",
      raw: digest(["111111111", "222222222", "333333333"]),
    }), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 3);
  });

  test("rows attributed to the right account", async () => {
    await emailWorker.email(message({
      to: `jobs+${TOKEN_B}@example.com`,
      from: "jobalerts-noreply@linkedin.com",
    }), env);
    const b = env.DB.raw.prepare("SELECT id FROM accounts WHERE token=?").get(TOKEN_B);
    const all = rows(env, "SELECT account_id FROM alerts");
    assert.equal(all.length, 1);
    assert.equal(all[0].account_id, b.id);
  });

  test("re-sent digest adds nothing (dedup on job id)", async () => {
    const m = () => message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "jobalerts-noreply@linkedin.com",
      raw: digest(["444444444", "555555555"]),
    });
    await emailWorker.email(m(), env);
    await emailWorker.email(m(), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 2);
  });

  test("a genuinely new role is added", async () => {
    const send = (ids) => emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "jobalerts-noreply@linkedin.com",
      raw: digest(ids),
    }), env);
    await send(["666666666"]);
    await send(["666666666", "777777777"]);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 2);
  });

  test("unknown token stores nothing", async () => {
    await emailWorker.email(message({
      to: `jobs+${"z".repeat(32)}@example.com`,
      from: "jobalerts-noreply@linkedin.com",
    }), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 0);
    assert.equal(rows(env, "SELECT * FROM rejected").length, 0);
  });

  test("unknown sender cannot inject a role", async () => {
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "attacker@evil.example",
      raw: digest(["888888888"]),
    }), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 0);
  });

  test("the attempt is recorded rather than dropped", async () => {
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "attacker@evil.example",
      subject: "urgent role",
    }), env);
    const r = rows(env, "SELECT * FROM rejected");
    assert.equal(r.length, 1);
    assert.equal(r[0].sender, "attacker@evil.example");
    assert.equal(r[0].subject, "urgent role");
  });

  // A substring check accepts this: the attacker registers
  // linkedin.com.evil.tld, so the mail passes SPF and DKIM on its own domain
  // and arrives fully authenticated.
  test("a lookalike sender domain cannot inject a role", async () => {
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "jobalerts-noreply@linkedin.com.evil.tld",
      raw: digest(["313131313"]),
    }), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 0);
    assert.equal(rows(env, "SELECT * FROM rejected").length, 1);
  });

  test("a display-name From still resolves to the address", async () => {
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      raw: digest(["323232323"]),
    }), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 1);
  });

  // Alert mail is quoted-printable more often than not, and a wrapped URL
  // arrives as ...jobs/vie=\r\nw/12345. Matching raw bytes loses the id.
  test("quoted-printable soft breaks do not hide a job id", async () => {
    const raw = [
      "From: LinkedIn Job Alerts",
      "Subject: jobs for you",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      'a href=3D"https://www.linkedin.com/comm/jobs/vie=',
      'w/454545454/?trk=3Dx"Role',
    ].join("\r\n");
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "jobalerts-noreply@linkedin.com",
      raw,
    }), env);
    const a = rows(env, "SELECT * FROM alerts");
    assert.equal(a.length, 1);
    assert.equal(a[0].job_id, "454545454");
  });

  // Rows without a job id used to escape the partial unique index entirely.
  test("a re-sent no-job-id alert is not counted twice", async () => {
    const m = () => message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "info@executiveplacements.com",
      subject: "A role you may like",
      raw: "From: EP\r\nSubject: A role you may like\r\n\r\nno links here",
    });
    await emailWorker.email(m(), env);
    await emailWorker.email(m(), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 1);
  });

  test("no-job-id alert still stored", async () => {
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "info@executiveplacements.com",
      subject: "A role you may like",
      raw: "From: EP\r\nSubject: A role you may like\r\n\r\nno links here",
    }), env);
    const a = rows(env, "SELECT * FROM alerts");
    assert.equal(a.length, 1);
    assert.equal(a[0].job_id, null);
  });

  test("address without a token is ignored", async () => {
    await emailWorker.email(message({
      to: "jobs@example.com",
      from: "jobalerts-noreply@linkedin.com",
    }), env);
    assert.equal(rows(env, "SELECT * FROM alerts").length, 0);
  });
});

describe("feed api", () => {
  let env;
  beforeEach(async () => {
    env = makeEnv();
    await emailWorker.email(message({
      to: `jobs+${TOKEN_A}@example.com`,
      from: "jobalerts-noreply@linkedin.com",
      subject: "jobs for you",
      raw: digest(["999999999"]),
    }), env);
  });

  const get = (path) => apiWorker.fetch(new Request(`https://w.example${path}`), env);

  test("valid token returns 200", async () => {
    assert.equal((await get(`/feed/${TOKEN_A}`)).status, 200);
  });

  test("feed returns the stored alert", async () => {
    const body = await (await get(`/feed/${TOKEN_A}`)).json();
    assert.equal(body.alerts.length, 1);
    assert.equal(body.alerts[0].job_id, "999999999");
  });

  test("wrong token returns 404", async () => {
    assert.equal((await get(`/feed/${"c".repeat(32)}`)).status, 404);
  });

  test("names the dashboard origin, never a wildcard", async () => {
    env.DASHBOARD_ORIGIN = "https://dashboard.example";
    const r = await get(`/feed/${TOKEN_A}`);
    assert.equal(r.headers.get("access-control-allow-origin"), "https://dashboard.example");
    assert.equal(r.headers.get("vary"), "origin");
  });

  // The token sits in the URL, so a wildcard would let any page the user
  // happens to visit read their whole feed. A missing var must fail closed:
  // the dashboard breaks loudly rather than the feed opening silently.
  test("missing origin var sends no CORS header at all", async () => {
    delete env.DASHBOARD_ORIGIN;
    const r = await get(`/feed/${TOKEN_A}`);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  });

  test("bad path returns the same 404 shape", async () => {
    const bad = await get("/feed/short");
    const wrong = await get(`/feed/${"c".repeat(32)}`);
    assert.equal(bad.status, wrong.status);
    assert.equal(await bad.text(), await wrong.text());
  });
});
