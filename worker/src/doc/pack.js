/**
 * The neutral content model every format renders from.
 *
 * Markdown, Word and PDF are built from ONE structure rather than three
 * templates. Three templates drift: a change lands in the .md, the .docx keeps
 * last month's wording, and nobody notices because nobody opens all three.
 *
 * Blocks are deliberately few - h1/h2/h3, p, ul, kv, rule, small - because
 * every one of them has to be implementable in a PDF writer that has no layout
 * engine. Anything richer would be honoured in Word and silently dropped in
 * the PDF, which is the same drift by another route.
 */

const DATE = (ms) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/**
 * @param {object} o
 * @param {string} o.label      what the account called itself
 * @param {number} o.at         epoch ms
 * @param {Array}  o.jobs       every role that arrived
 * @param {object|null} o.ranking  the model's output, or null
 * @param {string} [o.rankingNote] why there is no ranking
 */
export function buildPack({ label, at, jobs, ranking, rankingNote }) {
  const blocks = [];
  const push = (b) => blocks.push(b);

  push({ t: "h1", text: "Job Pack" });
  push({
    t: "kv",
    items: [
      { k: "Prepared", v: DATE(at) },
      { k: "Roles in this digest", v: String(jobs.length) },
      ...(label ? [{ k: "Feed", v: label }] : []),
    ],
  });
  push({ t: "rule" });

  if (ranking && ranking.summary) {
    push({ t: "h2", text: "Summary" });
    push({ t: "p", text: ranking.summary });
  } else {
    push({ t: "h2", text: "Summary" });
    push({
      t: "p",
      text:
        "These roles arrived but were not ranked" +
        (rankingNote ? ` — ${rankingNote}.` : ".") +
        " The full list is below, unscored. Nothing here has been assessed against your profile, so treat the order as arrival order and not as a recommendation.",
    });
  }

  const ranked = (ranking && Array.isArray(ranking.ranked) ? ranking.ranked : [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const worth = ranked.filter((r) => r.score >= 3);
  if (worth.length) {
    push({ t: "h2", text: "Recommended, by ranking" });
    worth.forEach((r, i) => {
      push({ t: "h3", text: `${i + 1}. ${r.title} — ${r.score}/5 (${r.verdict})` });
      const where = [r.company, r.location].filter(Boolean).join(" · ");
      if (where) push({ t: "small", text: where });
      push({ t: "p", text: r.why });
      if (r.concerns && r.concerns.length) {
        push({ t: "small", text: "Concerns" });
        push({ t: "ul", items: r.concerns });
      }
      if (r.tweaks && r.tweaks.length) {
        push({ t: "small", text: "CV changes before you apply" });
        push({ t: "ul", items: r.tweaks.map((x) => `${x.change} — ${x.why}`) });
      }
      if (r.url) push({ t: "small", text: r.url });
    });
  }

  const skipped = ranked.filter((r) => r.score < 3);
  if (skipped.length) {
    push({ t: "h2", text: "Ranked low, and why" });
    push({
      t: "ul",
      items: skipped.map((r) => `${r.title} (${r.score}/5) — ${r.why}`),
    });
  }

  push({ t: "h2", text: "Everything that arrived" });
  push({
    t: "ul",
    items: jobs.map((j) => {
      const where = [j.company, j.location].filter(Boolean).join(" · ");
      return where ? `${j.title} — ${where}` : j.title;
    }),
  });

  push({ t: "rule" });
  push({ t: "h2", text: "How this was put together" });
  push({
    t: "ul",
    items: [
      "The roles were read out of the alert emails forwarded to this feed. Nothing was scraped and no job board was logged into.",
      "The ranking compares each advert against a profile derived from your CV — titles, skills, seniority and years. The CV itself was never uploaded and is not stored.",
      "CV suggestions only re-word, re-order or re-emphasise what your profile already contains, or tell you to add something true that is missing. Nothing here invents a qualification, and no hidden text is ever added to a document.",
      "A score is a reading of an advert, not a prediction. Read the advert before you act on it.",
    ],
  });

  return {
    title: "Job Pack",
    subtitle: `${DATE(at)} · ${jobs.length} role${jobs.length === 1 ? "" : "s"}`,
    blocks,
  };
}
