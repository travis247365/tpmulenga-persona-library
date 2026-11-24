#!/usr/bin/env python3
"""Scan outgoing application documents for content that must never ship.

    leakscan.py FILE [FILE ...]

Exit 0 clean, 1 findings, 2 could not read a file. Handles .docx, .pdf, .md
and .txt. Every rule below exists because the content it catches either
breaches a contract, contradicts a certificate, or would fail verification.

Patterns are word-bounded on purpose. An earlier hand-rolled scan matched
"signed" inside "designed" and reported three leaks that were not there,
which costs trust in the gate itself.
"""

import re
import sys
import zipfile
from pathlib import Path

# (id, severity, human description, compiled pattern)
def _w(*alts):
    """Word-bounded alternation."""
    return re.compile(r"\b(?:" + "|".join(alts) + r")\b", re.I)

RULES = [
    ("CLIENT-NAME", "red",
     "names a d2c client; Sanlam cl. 8.3.3, RDG cl. 8.2, Sun King MSA cl. 7.1-7.2",
     _w(r"sanlam", r"sun\s*king", r"ignite\s+energy(\s+access)?", r"RDG",
        r"exponent\s+bizolution")),

    ("VENDOR-NAME", "red",
     "names a client-side vendor from the contracts",
     _w(r"DIRA", r"oxylane", r"sagenet", r"dialshree")),

    ("ZMW-FIGURE", "red",
     "quotes a ZMW figure; none reconciles to a source record",
     re.compile(r"\bZMW\s*[\d.,]+\s*(?:m|mn|mil|million|k)?\b", re.I)),

    ("SIGNED-CLAIM", "red",
     "claims execution; signature blocks are blank, so it is issued for "
     "signature, not signed",
     _w(r"signed\s+(?:agreement|contract|MSP)", r"executed\s+(?:agreement|contract)",
        r"countersigned", r"fully\s+executed")),

    ("TURNAROUND", "red",
     "claims a turnaround the records do not support",
     _w(r"turn(?:ed|ing)?[-\s]?around", r"turnaround")),

    ("CREDENTIAL", "red",
     "misstates a credential; the Henley award is a Postgraduate Diploma in "
     "Management Practice and there is no law qualification",
     _w(r"MBA", r"master\s+of\s+business", r"commercial\s+lawyer",
        r"law\s+(?:degree|qualification)", r"AHCZ")),

    ("BAD-DOMAIN", "red",
     "wrong contact domain; travispaulconsultant.co is not registered and "
     "mail to it bounces",
     re.compile(r"travispaulconsultant\.co", re.I)),

    ("BUILT-CLAIM", "amber",
     "says 'built' where a vendor product is involved; 'led delivery of' is "
     "both accurate and more senior",
     _w(r"built\s+the\s+(?:CRM|platform)", r"we\s+built\s+the")),

    ("MOMO", "amber",
     "mentions the MTN MoMo account; the contract was terminated during the "
     "COO tenure and its MD is a named referee",
     _w(r"MTN\s+Mobile\s+Money", r"MoMo")),
]


def read_docx(path):
    """Return (visible_text, hidden_runs). Hidden = white or vanished."""
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist()
                 if n.startswith("word/") and n.endswith(".xml")]
        xml = "\n".join(z.read(n).decode("utf-8", "replace") for n in names)

    # A run is hidden if it carries w:vanish, or a white/near-white colour.
    hidden = []
    for run in re.findall(r"<w:r[ >].*?</w:r>", xml, re.S):
        props = re.search(r"<w:rPr>.*?</w:rPr>", run, re.S)
        if props:
            p = props.group(0)
            white = _is_white(p)
            if "<w:vanish" in p or white:
                txt = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", run, re.S))
                if txt.strip():
                    hidden.append(txt.strip())

    return _flatten(xml), hidden


def _is_white(props: str) -> bool:
    """True when a run's colour is white or near-white.

    The obvious pattern F{2}[F\d]{4} also matches FF0000, FF6600 and FFCC00 -
    ordinary red and amber - so every emphasised heading was reported as hidden
    ATS text. Parse the hex and require all three channels to be light instead.
    """
    m = re.search(r'<w:color[^>]*w:val="([0-9A-F]{6})"', props, re.I)
    if not m:
        return False
    v = m.group(1)
    r, g, b = (int(v[i:i + 2], 16) for i in (0, 2, 4))
    return r >= 0xF0 and g >= 0xF0 and b >= 0xF0


def _flatten(xml: str) -> str:
    """Document text with run boundaries closed up, paragraphs kept apart.

    Replacing every tag with a space breaks the scan: Word splits a word into
    separate runs on any formatting change - a stray italic, a spellcheck mark,
    a tracked edit - so a forbidden client name routinely sits in the file as
    "San" + "lam". With spaces inserted between runs it reads as "San lam" and
    matches no rule, and the document ships. Joining runs with nothing and
    breaking only on paragraph and table-cell ends gives the text a reader
    actually sees.
    """
    # Paragraph and cell ends become newlines so separate fields cannot merge
    # into a word that was never written.
    xml = re.sub(r"</w:(p|tc|tr)>", "\n", xml, flags=re.I)
    xml = re.sub(r"<w:br[^>]*/?>", "\n", xml, flags=re.I)
    xml = re.sub(r"<w:tab[^>]*/?>", "\t", xml, flags=re.I)
    # Everything else closes up: run boundaries are not word boundaries.
    return re.sub(r"<[^>]+>", "", xml)


def read_pdf(path):
    from pypdf import PdfReader
    return "\n".join(pg.extract_text() or "" for pg in PdfReader(str(path)).pages), []


def read_text(path):
    return Path(path).read_text(encoding="utf-8", errors="replace"), []


READERS = {".docx": read_docx, ".pdf": read_pdf, ".md": read_text, ".txt": read_text}


def scan(path):
    p = Path(path)
    reader = READERS.get(p.suffix.lower())
    if reader is None:
        return None, f"unsupported file type {p.suffix!r}"
    try:
        text, hidden = reader(p)
    except Exception as exc:                      # noqa: BLE001 - report, don't crash
        return None, f"{type(exc).__name__}: {exc}"

    findings = []
    for rid, sev, desc, pat in RULES:
        for m in pat.finditer(text):
            findings.append((rid, sev, desc, m.group(0).strip()))

    for run in hidden:
        findings.append(("HIDDEN-TEXT", "red",
                         "hidden text aimed at an ATS or AI screener; never ship this",
                         run[:60]))
    return findings, None


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    worst, unreadable = 0, False
    for path in argv[1:]:
        findings, err = scan(path)
        if err:
            print(f"{path}: CANNOT READ - {err}")
            unreadable = True
            continue
        if not findings:
            print(f"{path}: clean")
            continue
        # Deduplicate: one line per rule per file, with distinct matches.
        seen = {}
        for rid, sev, desc, match in findings:
            seen.setdefault((rid, sev, desc), set()).add(match)
        for (rid, sev, desc), matches in seen.items():
            shown = ", ".join(sorted(matches)[:4])
            print(f"{path}: {sev.upper():5} {rid}: {desc}\n{'':>{len(path)+2}}   found: {shown}")
        worst = 1
    return 2 if unreadable else worst


if __name__ == "__main__":
    sys.exit(main(sys.argv))
