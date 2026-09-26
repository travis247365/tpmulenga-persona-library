/**
 * Copy the hand-authored static pages into the vite public directory.
 *
 * Two problems this solves, both found by review rather than by anything
 * failing loudly:
 *
 *   1. `dashboard/index.html` and `client/public/dashboard/index.html` were
 *      byte-identical copies, checked in separately and published by two
 *      different scripts. Editing one shipped stale content on the other, and
 *      nothing anywhere would have said so.
 *   2. `app/` (Persona Forge) sat outside vite's root AND outside its
 *      publicDir, so it was in neither deploy target. The app was written,
 *      tested and committed, and was unreachable on every deployed surface.
 *
 * The top-level directories are now the only authored copies. The generated
 * ones under client/public are gitignored, so they cannot drift: whatever is
 * there was put there by this script, from a single source.
 */
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "client", "public");

// source directory -> path it is served at
const PAGES = [
  ["app", "app"],
  ["dashboard", "dashboard"],
  ["personas", "personas"],
];

// personas/ also holds the markdown the page is written from; only the page
// itself is published.
const ONLY_HTML = new Set(["personas"]);

// app/tokens.css is the single design source. The dashboard also deploys
// STANDALONE to its own Pages subdomain, where "../app/tokens.css" resolves to
// nothing, so it gets a generated copy beside it and references it locally.
// Generated, gitignored, one source - the copy cannot drift from the original
// the way the two checked-in dashboards did.
const TOKENS_COPIES = [["dashboard", "tokens.css"]];

for (const [src, dest] of PAGES) {
  const from = join(root, src);
  const to = join(publicDir, dest);
  if (!existsSync(from)) {
    console.error(`sync-static: ${src}/ is missing`);
    process.exit(1);
  }
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  await cp(from, to, {
    recursive: true,
    filter: (p) => {
      if (!ONLY_HTML.has(src)) return true;
      return !p.endsWith(".md");
    },
  });
  console.log(`sync-static: ${src}/ -> client/public/${dest}/`);
}

for (const [dir, name] of TOKENS_COPIES) {
  await cp(join(root, "app", "tokens.css"), join(publicDir, dir, name));
  await cp(join(root, "app", "tokens.css"), join(root, dir, name));
  console.log(`sync-static: app/tokens.css -> ${dir}/${name}`);
}
