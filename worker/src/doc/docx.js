/**
 * A .docx written by hand: Open XML in a ZIP, no library.
 *
 * Honest limitation up front: Poppins is named as the document font, but a
 * .docx references fonts by name rather than embedding them. On a machine
 * without Poppins installed Word substitutes, and the file will not look like
 * the brand. Embedding would mean shipping an obfuscated .ttf per weight
 * inside every email, which is both heavy and licence-sensitive, so the font
 * is named and the fallback is a clean sans rather than a serif.
 */
import { zip } from "./zip.js";

const CHARCOAL = "3A3A3A";
const AMBER = "FFC107";
const SLATE = "6B6B6B";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Word rejects the document outright on a raw control character, which is
    // exactly the kind of thing that arrives inside a scraped job title.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Poppins" w:hAnsi="Poppins" w:cs="Poppins"/>
<w:color w:val="${CHARCOAL}"/><w:sz w:val="21"/>
</w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>`;

/** One paragraph. `opts` maps to the handful of run properties we use. */
function para(text, opts = {}) {
  const { size = 21, bold = false, color = CHARCOAL, before = 0, after = 120,
          bullet = false, rule = false } = opts;
  const pPr = [
    `<w:spacing w:before="${before}" w:after="${after}"/>`,
    bullet ? `<w:ind w:left="360" w:hanging="180"/>` : "",
    rule ? `<w:pBdr><w:bottom w:val="single" w:sz="12" w:color="${AMBER}"/></w:pBdr>` : "",
  ].join("");
  const rPr = [
    `<w:rFonts w:ascii="Poppins" w:hAnsi="Poppins"/>`,
    bold ? "<w:b/>" : "",
    `<w:color w:val="${color}"/>`,
    `<w:sz w:val="${size}"/>`,
  ].join("");
  const body = rule && !text ? "" :
    `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${esc(bullet ? "— " + text : text)}</w:t></w:r>`;
  return `<w:p><w:pPr>${pPr}</w:pPr>${body}</w:p>`;
}

export function toDocx(pack) {
  const body = [];

  // The accent block: TPCL puts a solid amber bar top-left. In Word the
  // nearest honest equivalent is a short shaded paragraph, not an image.
  body.push(
    `<w:p><w:pPr><w:spacing w:after="80"/><w:shd w:val="clear" w:fill="${AMBER}"/>` +
    `<w:ind w:right="8400"/></w:pPr><w:r><w:rPr><w:sz w:val="12"/></w:rPr>` +
    `<w:t xml:space="preserve"> </w:t></w:r></w:p>`
  );
  body.push(para(pack.title, { size: 52, bold: true, after: 60 }));
  body.push(para(pack.subtitle, { size: 18, color: SLATE, after: 240 }));

  for (const b of pack.blocks) {
    switch (b.t) {
      case "h1": break;                                  // the title already carries it
      case "h2": body.push(para(b.text, { size: 28, bold: true, before: 280, after: 100 })); break;
      case "h3": body.push(para(b.text, { size: 23, bold: true, before: 200, after: 60 })); break;
      case "p":  body.push(para(b.text)); break;
      case "small": body.push(para(b.text, { size: 17, color: SLATE, after: 60 })); break;
      case "ul": for (const i of b.items) body.push(para(i, { bullet: true, after: 60 })); break;
      case "kv": for (const i of b.items) body.push(para(`${i.k}: ${i.v}`, { size: 18, color: SLATE, after: 40 })); break;
      case "rule": body.push(para("", { rule: true, before: 160, after: 160 })); break;
      default: break;
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join("")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: RELS },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS },
    { name: "word/styles.xml", data: STYLES },
    { name: "word/document.xml", data: document },
  ]);
}
