#!/usr/bin/env python3
"""Render a .docx and check it against the pack's presentation rules.

    packcheck.py --pages N --family "Trebuchet MS" FILE.docx [FILE.docx ...]

Renders each file to PDF with LibreOffice, then verifies:

  * page count is exactly N (a CV that silently spills to three pages is the
    single most common regression in this pipeline)
  * every font used belongs to the required family - a stray fallback such as
    Times New Roman or Helvetica means a glyph is missing from the family,
    usually an arrow or a currency symbol, and it shows in the rendered PDF
  * the document author is set, and is the candidate

Exit 0 pass, 1 fail, 2 could not render.
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

AUTHOR = "Travis Paul Mulenga"


def render(docx: Path, outdir: Path) -> Path:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice not found; cannot render")
    subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(docx)],
        check=True, capture_output=True, timeout=180,
    )
    pdf = outdir / (docx.stem + ".pdf")
    if not pdf.exists():
        raise RuntimeError("LibreOffice produced no PDF")
    return pdf


def fonts_used(pdf: Path) -> set[str]:
    """Base font names, stripped of the ABCDEF+ subset prefix."""
    from pypdf import PdfReader

    names: set[str] = set()
    for page in PdfReader(str(pdf)).pages:
        res = page.get("/Resources")
        if res is None:
            continue
        fonts = res.get_object().get("/Font")
        if fonts is None:
            continue
        for ref in fonts.get_object().values():
            base = ref.get_object().get("/BaseFont")
            if base:
                names.add(re.sub(r"^[A-Z]{6}\+", "", str(base).lstrip("/")))
    return names


def family_installed(family: str) -> bool:
    """Is the family available to LibreOffice on this machine?

    Without this check, a machine simply missing the font reports every font
    in the PDF as a stray fallback - which looks identical to a real glyph
    gap but needs the opposite fix. Say which one it is.
    """
    fc = shutil.which("fc-list")
    if not fc:
        return True                       # cannot tell; do not invent a failure
    out = subprocess.run([fc, ":", "family"], capture_output=True, text=True, timeout=30)
    have = {f.strip().lower() for line in out.stdout.splitlines() for f in line.split(",")}
    return family.strip().lower() in have


def author_of(docx: Path) -> str:
    from docx import Document
    return (Document(str(docx)).core_properties.author or "").strip()


def check(docx: Path, want_pages: int, family: str) -> list[str]:
    from pypdf import PdfReader

    problems: list[str] = []
    if not family_installed(family):
        problems.append(
            f"{family} is not installed on this machine, so the render substitutes "
            f"another face and the PDF will not match the Mac's output; font "
            f"findings below are unreliable until it is installed"
        )
    with tempfile.TemporaryDirectory() as td:
        pdf = render(docx, Path(td))

        pages = len(PdfReader(str(pdf)).pages)
        if pages != want_pages:
            problems.append(f"{pages} pages, expected {want_pages}")

        # Compare on the family with spaces removed: PDF base names are
        # written "TrebuchetMS-Bold", not "Trebuchet MS Bold".
        key = family.replace(" ", "").lower()
        strays = sorted(f for f in fonts_used(pdf) if key not in f.replace(" ", "").lower())
        if strays:
            problems.append(
                f"fallback font(s) {', '.join(strays)} - a glyph is missing from {family}"
            )

    who = author_of(docx)
    if who != AUTHOR:
        problems.append(f"author is {who!r}, expected {AUTHOR!r}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, required=True)
    ap.add_argument("--family", default="Trebuchet MS")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()

    failed = False
    for f in a.files:
        try:
            problems = check(Path(f), a.pages, a.family)
        except Exception as exc:                       # noqa: BLE001
            print(f"{f}: CANNOT RENDER - {type(exc).__name__}: {exc}")
            return 2
        if problems:
            failed = True
            for p in problems:
                print(f"{f}: FAIL {p}")
        else:
            print(f"{f}: pass ({a.pages}pp, {a.family} only, author set)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
