/**
 * A PDF written by hand: objects, an xref table, and a content stream.
 *
 * Two honest limitations, both consequences of not shipping a font:
 *
 *   1. The type is Helvetica, one of the fourteen faces every PDF reader
 *      already has, NOT Poppins. Embedding Poppins would mean subsetting a
 *      TrueType file and writing the font descriptor by hand inside an email
 *      attachment. The brand survives in the charcoal, the amber accent block
 *      and the layout; the letterforms do not.
 *   2. Text is WinAnsi. Anything outside it - an em dash is fine, an emoji is
 *      not - is replaced rather than drawn, because a byte a reader cannot map
 *      renders as a wrong glyph, which is worse than a visible "?".
 *
 * Line breaking measures each string against the real Helvetica widths. An
 * estimate instead ("about half the point size per character") overflows the
 * margin on capitals and leaves a ragged gap on lowercase.
 */

// AFM advance widths, 1/1000 em, for codes 32-126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,278,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** CP1252 slots for the punctuation this pack actually emits. */
const CP1252 = new Map([
  [0x2014, 0x97], [0x2013, 0x96], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2026, 0x85],
  [0x2122, 0x99], [0x20ac, 0x80], [0x00a0, 0x20],
]);

/** Map a JS string to WinAnsi bytes-as-chars, replacing what will not fit. */
function winansi(s) {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c === 9) { out += " "; continue; }
    if (c >= 32 && c <= 126) out += ch;
    else if (CP1252.has(c)) out += String.fromCharCode(CP1252.get(c));
    else if (c >= 0xa1 && c <= 0xff) out += String.fromCharCode(c);
    else out += "?";
  }
  return out;
}

function widthOf(text, size, bold) {
  const table = bold ? W_BOLD : W_REG;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    w += c >= 32 && c <= 126 ? table[c - 32] : 556;   // 556 for the WinAnsi tail
  }
  return (w * size) / 1000;
}

function wrap(text, size, bold, maxWidth) {
  const words = winansi(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (widthOf(next, size, bold) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const pdfString = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 56;
const BODY_W = PAGE_W - MARGIN * 2;
const CHARCOAL = "0.227 0.227 0.227";
const SLATE = "0.42 0.42 0.42";
const AMBER = "1 0.757 0.027";

/** Pack blocks -> a flat list of drawable lines with their style. */
function layout(pack) {
  const S = {
    h1:    { size: 26, bold: true,  lead: 30, before: 0,  after: 4,  color: CHARCOAL },
    sub:   { size: 9,  bold: false, lead: 13, before: 0,  after: 18, color: SLATE },
    h2:    { size: 14, bold: true,  lead: 18, before: 18, after: 6,  color: CHARCOAL },
    h3:    { size: 11, bold: true,  lead: 15, before: 12, after: 3,  color: CHARCOAL },
    p:     { size: 10, bold: false, lead: 14, before: 0,  after: 8,  color: CHARCOAL },
    small: { size: 8,  bold: false, lead: 11, before: 0,  after: 5,  color: SLATE },
    li:    { size: 10, bold: false, lead: 14, before: 0,  after: 4,  color: CHARCOAL, indent: 14 },
  };
  const items = [];
  const emit = (text, st, extra = {}) => {
    const indent = extra.indent || st.indent || 0;
    const lines = wrap(text, st.size, st.bold, BODY_W - indent);
    lines.forEach((l, i) => items.push({
      text: i === 0 && extra.marker ? extra.marker + l : l,
      size: st.size, bold: st.bold, lead: st.lead, color: st.color,
      indent: i === 0 && extra.marker ? indent - 10 : indent,
      before: i === 0 ? st.before : 0,
      after: i === lines.length - 1 ? st.after : 0,
    }));
  };

  emit(pack.title, S.h1);
  emit(pack.subtitle, S.sub);

  for (const b of pack.blocks) {
    switch (b.t) {
      case "h1": break;
      // No auto-rule here. The pack decides where rules go; a renderer that
      // adds its own makes the PDF show structure the .md and .docx do not,
      // which is the drift the shared model exists to prevent.
      case "h2": emit(b.text, S.h2); break;
      case "h3": emit(b.text, S.h3); break;
      case "p": emit(b.text, S.p); break;
      case "small": emit(b.text, S.small); break;
      case "ul": for (const i of b.items) emit(i, S.li, { marker: "-  " }); break;
      case "kv": for (const i of b.items) emit(`${i.k}: ${i.v}`, S.small); break;
      case "rule": items.push({ rule: true, before: 10, after: 10 }); break;
      default: break;
    }
  }
  return items;
}

export function toPdf(pack) {
  const items = layout(pack);

  // Flow into pages. The accent block sits at the top of page one only, so
  // page one starts lower than the rest.
  const TOP = PAGE_H - MARGIN;
  const BOTTOM = MARGIN + 24;
  const pages = [];
  let page = [];
  let y = TOP - 26;

  for (const it of items) {
    const need = (it.before || 0) + (it.rule ? 1 : it.lead);
    if (y - need < BOTTOM) { pages.push(page); page = []; y = TOP; }
    y -= it.before || 0;
    if (it.rule) {
      page.push(`${AMBER} RG 1 w ${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l S`);
      y -= 1;
    } else {
      y -= it.lead;
      page.push(
        `BT ${it.color} rg /F${it.bold ? 2 : 1} ${it.size} Tf ` +
        `1 0 0 1 ${(MARGIN + (it.indent || 0)).toFixed(2)} ${y.toFixed(2)} Tm ` +
        `(${pdfString(it.text)}) Tj ET`
      );
    }
    y -= it.after || 0;
  }
  pages.push(page);

  // The TPCL accent block, page one, top-left.
  pages[0].unshift(`${AMBER} rg ${MARGIN} ${(PAGE_H - MARGIN - 14).toFixed(2)} 44 10 re f`);

  // Page numbers, so a printed pack does not shuffle.
  pages.forEach((p, i) => {
    if (pages.length < 2) return;
    p.push(
      `BT ${SLATE} rg /F1 8 Tf 1 0 0 1 ${(PAGE_W - MARGIN - 40).toFixed(2)} ${MARGIN.toFixed(2)} Tm ` +
      `(${i + 1} of ${pages.length}) Tj ET`
    );
  });

  // ---- assemble ---------------------------------------------------------
  // Object numbering is fixed so the Kids array can be written before the
  // page objects exist: 1 catalog, 2 pages, 3/4 fonts, then page/content
  // pairs from 5.
  const objs = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
  pages.forEach((ops, i) => {
    const id = pageIds[i];
    const stream = ops.join("\n");
    objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
               `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objs[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  const chunks = [];
  const offsets = [];
  let pos = 0;
  const put = (s) => { chunks.push(s); pos += s.length; };

  put("%PDF-1.4\n");
  // A binary comment marks the file as binary for transfer agents that would
  // otherwise "helpfully" rewrite line endings and corrupt the stream.
  put("%\xE2\xE3\xCF\xD3\n");
  for (let n = 1; n < objs.length; n++) {
    if (!objs[n]) continue;
    offsets[n] = pos;
    put(`${n} 0 obj\n${objs[n]}\nendobj\n`);
  }
  const xref = pos;
  const count = objs.length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) {
    table += offsets[n] === undefined
      ? `0000000000 65535 f \n`
      : `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  put(table);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  // Latin-1, not UTF-8: the strings are already WinAnsi bytes, and encoding
  // them as UTF-8 would turn every byte above 127 into two and break every
  // offset in the xref table.
  const text = chunks.join("");
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}
