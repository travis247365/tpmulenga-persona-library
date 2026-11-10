#!/usr/bin/env python3
"""
TPCL share pack — builds the one folder you hand to a claude.ai (web) user.

Renders src/guidelines.html and src/webguide.html with fonts + logos inlined, prints
both to PDF via headless Chrome, and assembles pack/ with the logos, tokens.css and
an index. Run build_tpcl_ds.py first (this reuses its inlining).

Usage:  python3 build_pack.py
"""
from __future__ import annotations
import pathlib, re, shutil, subprocess, sys

import build_tpcl_ds as B

ROOT = pathlib.Path(__file__).resolve().parent
SRC, DIST, PACK = ROOT / "src", ROOT / "dist", ROOT / "TPCL_Share_Pack"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

DOCS = [
    # source,             rendered html,                  final pdf
    ("guidelines.html", "TPCL_Brand_Guidelines_v1.0.html", "TPCL_Brand_Guidelines_v1.0.pdf"),
    ("webguide.html",   "TPCL_Design_System_Guide.html",   "TPCL_Design_System_Guide.pdf"),
]


def render(src_name: str) -> str:
    """Inline fonts + logo marks into a standalone doc, same as the bundler does for cards."""
    html = (SRC / src_name).read_text()
    if "<!--TPCL_CORE-->" not in html:
        sys.exit(f"{src_name}: missing <!--TPCL_CORE--> placeholder")
    core = (SRC / "tpcl-core.css").read_text()
    style = "<style>\n" + B.font_face_css() + "\n" + core + "\n</style>"
    uris = {k: "data:image/png;base64," + B.b64(B.ASSETS / v) for k, v in B.LOGOS.items()}
    used = {k for k in B.LOGOS if k in html} | set(
        "{{LOGO_%s}}" % m.upper() for m in re.findall(r"tp-mark--(\w+)", html)
    ) & set(B.LOGOS)
    marks = "".join(
        ".tp-mark--%s{background-image:url(%s);}" % (k[7:-2].lower(), uris[k]) for k in sorted(used)
    )
    if marks:
        style = style[: -len("</style>")] + marks + "</style>"
    html = B.LOGO_IMG_RE.sub(B._img_to_mark, html)
    html = html.replace("<!--TPCL_CORE-->", style)
    for k, uri in uris.items():
        html = html.replace(k, uri)
    return html


def to_pdf(html_path: pathlib.Path, pdf_path: pathlib.Path) -> None:
    if not pathlib.Path(CHROME).exists():
        sys.exit(f"Chrome not found at {CHROME} — cannot print PDFs")
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={pdf_path}", html_path.as_uri()],
        check=True, capture_output=True, timeout=180,
    )


def main() -> None:
    if not (DIST / "tokens.css").exists():
        sys.exit("run build_tpcl_ds.py first")
    if PACK.exists():
        shutil.rmtree(PACK)
    (PACK / "logos").mkdir(parents=True)
    (PACK / "_source_html").mkdir()

    for src_name, html_name, pdf_name in DOCS:
        html = render(src_name)
        hp = PACK / "_source_html" / html_name
        hp.write_text(html)
        to_pdf(hp, PACK / pdf_name)
        print(f"  {(PACK/pdf_name).stat().st_size/1024:7.0f} KB  {pdf_name}")

    # Logos at full working resolution, straight from the durable brand copies.
    logo_src = pathlib.Path.home() / ".claude/projects/-Users-tpmulenga/memory/assets/tpcl_logos"
    for cut in ("white", "black", "colour"):
        shutil.copy2(logo_src / f"tpc_{cut}.png", PACK / "logos" / f"TravisPaulConsulting_{cut}.png")

    shutil.copy2(DIST / "tokens.css", PACK / "tokens.css")
    shutil.copy2(SRC / "README.md", PACK / "TPCL_Design_System_Spec.md")
    if (SRC / "pack_readme.md").exists():
        shutil.copy2(SRC / "pack_readme.md", PACK / "READ_ME_FIRST.md")

    # One zip is what actually gets sent. NB: don't use with_suffix here —
    # the "v1.0" in the stem means pathlib would treat ".0" as the extension.
    base = ROOT / "TPCL_Brand_Pack_v1.0"
    zip_file = pathlib.Path(str(base) + ".zip")
    if zip_file.exists():
        zip_file.unlink()
    shutil.make_archive(str(base), "zip", root_dir=PACK.parent, base_dir=PACK.name)
    print(f"\npack → {PACK}")
    print(f"zip  → {zip_file}  ({zip_file.stat().st_size/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
