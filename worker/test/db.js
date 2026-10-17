/**
 * The D1 stub, shared by every worker test file.
 *
 * It executes REAL SQL against node:sqlite using worker/schema.sql, so the
 * unique indexes that do the deduplication are the actual indexes the worker
 * will meet in production. A hand-rolled mock would let a dedup test pass
 * while the index was wrong, which is the one thing these tests exist to catch.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA = readFileSync(join(here, "..", "schema.sql"), "utf8");

/** Minimal D1 surface: prepare().bind().first()/run()/all(), and batch(). */
export function makeDB() {
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
