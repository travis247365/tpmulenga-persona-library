#!/usr/bin/env python3
"""
TPCL Design System — bundler.

Reads src/tpcl-core.css + src/pages/*.html and emits dist/ where every page is
a fully self-contained HTML file: Poppins (subset woff2) and the Travis Paul
Consulting logos are inlined as data URIs, so the pages render correctly under
Claude Design's strict CSP with no external requests.

Usage:  python3 build_tpcl_ds.py
"""
from __future__ import annotations
import base64, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC, PAGES, ASSETS, DIST = ROOT / "src", ROOT / "src/pages", ROOT / "src/assets", ROOT / "dist"

FONTS = {"Poppins-Regular.woff2": 400, "Poppins-Medium.woff2": 500, "Poppins-Bold.woff2": 700}
LOGOS = {"{{LOGO_WHITE}}": "tpc_white.png",
         "{{LOGO_BLACK}}": "tpc_black.png",
         "{{LOGO_COLOUR}}": "tpc_colour.png"}

# Placeholders the email tool fills in at send time — these ship through unchanged.
MERGE_TAGS = {"{{FIRST_NAME}}", "{{UNSUBSCRIBE_URL}}", "{{PREFERENCES_URL}}"}

# Pages that must keep literal <img> tags rather than CSS background marks.
EMAIL_PAGES = {"emailer.html"}

LOGO_IMG_RE = re.compile(r'<img\s+src="(\{\{LOGO_(?:WHITE|BLACK|COLOUR)\}\})"([^>]*?)/?>')
ALT_RE = re.compile(r'\s*alt="[^"]*"')


def _img_to_mark(m: "re.Match[str]") -> str:
    """<img src="{{LOGO_WHITE}}" alt=".." style=".."> -> <span class="tp-mark tp-mark--white" ..>"""
    cut = m.group(1)[7:-2].lower()          # {{LOGO_WHITE}} -> white
    attrs = ALT_RE.sub("", m.group(2)).rstrip()
    return (f'<span class="tp-mark tp-mark--{cut}" role="img" '
            f'aria-label="Travis Paul Consulting"{attrs}></span>')

# Where each page lands in the design-system project, and its card metadata.
# group -> the section label shown in the Claude Design "Design system" pane.
LAYOUT = {
    # ---- Foundations ----
    "colour.html":            ("foundations/colour.html",            "Foundations", "Colour",              "6 brand tokens + contrast rules", 1080, 1400),
    "typography.html":        ("foundations/typography.html",        "Foundations", "Typography",          "Poppins 400/500/700, 9-step scale", 1080, 1400),
    "logo.html":              ("foundations/logo.html",              "Foundations", "Logo & lockups",      "Placement, clear space, don'ts", 1080, 1200),
    "motifs.html":            ("foundations/motifs.html",            "Foundations", "Motifs (brand DNA)",  "Accent block, chip, outline, timeline", 1080, 1300),
    "layout-grid.html":       ("foundations/layout-grid.html",       "Foundations", "Layout & spacing",    "8px scale, 12-col grid, slide modes", 1080, 1200),
    # ---- Components ----
    "buttons.html":           ("components/buttons.html",            "Components",  "Buttons",             "4 variants, 2 sizes, light + dark", 1080, 700),
    "cards.html":             ("components/cards.html",              "Components",  "Cards & panels",      "Default, panel, dark, accent-rule", 1080, 800),
    "stat-tiles.html":        ("components/stat-tiles.html",         "Components",  "Stat tiles & KPI row","Tabular figures, light + dark", 1080, 750),
    "timeline.html":          ("components/timeline.html",           "Components",  "Timeline & steps",    "Cyan rule, dots, numbered boxes", 1080, 900),
    "table-quote.html":       ("components/table-quote.html",        "Components",  "Tables & quotes",     "Data table, statement, tags", 1080, 900),
    # ---- Templates: social ----
    "social-square.html":     ("templates/social-square-1080.html",  "Templates · Social", "Instagram / Facebook square", "1080 × 1080 · dark statement", 1080, 1330),
    "social-portrait.html":   ("templates/social-portrait-1080x1350.html", "Templates · Social", "Instagram / LinkedIn portrait", "1080 × 1350 (4:5) · light insight", 1080, 1610),
    "social-story.html":      ("templates/social-story-1080x1920.html","Templates · Social", "Story / Reel cover", "1080 × 1920 (9:16) + safe zones", 1080, 2190),
    "whatsapp-status.html":   ("templates/whatsapp-status-1080x1920.html","Templates · Social", "WhatsApp Status", "1080 × 1920, WA chrome safe zones", 1080, 2260),
    # ---- Templates: LinkedIn ----
    "linkedin-single.html":   ("templates/linkedin-single-1200x627.html", "Templates · LinkedIn", "LinkedIn single image post", "1200 × 627 (1.91:1) · also the link-preview crop", 1200, 900),
    "linkedin-carousel.html": ("templates/linkedin-carousel-1080x1350.html","Templates · LinkedIn", "LinkedIn carousel / document", "1080 × 1350 · cover, inner, CTA", 1080, 4460),
    "linkedin-banner.html":   ("templates/linkedin-banner-1584x396.html","Templates · LinkedIn", "LinkedIn banners", "1584 × 396 personal + 1128 × 191 page", 1584, 1080),
    # ---- Templates: Email ----
    "emailer.html":           ("templates/emailer-600.html",         "Templates · Email", "Email newsletter", "600px, table-based, client-safe", 700, 1900),
    # ---- Templates: Web ----
    "website-hero.html":      ("templates/website-hero.html",        "Templates · Website", "Website hero",   "7/5 split dark + blue-gray, 1440 frame", 1440, 1000),
    "website-sections.html":  ("templates/website-sections.html",    "Templates · Website", "Website sections", "Services, statement, proof, CTA, footer", 1440, 2900),
    # ---- Templates: Deck ----
    "slide-16x9.html":        ("templates/slide-16x9.html",          "Templates · Deck", "Slide masters 16:9", "Cover, split, content, statement", 1280, 3400),
}


def b64(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def font_face_css() -> str:
    out = []
    for fname, weight in FONTS.items():
        p = ASSETS / fname
        if not p.exists():
            sys.exit(f"missing font: {p}")
        out.append(
            "@font-face{font-family:'Poppins';font-style:normal;font-weight:%d;"
            "font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2');}"
            % (weight, b64(p))
        )
    return "".join(out)


def main() -> None:
    core = (SRC / "tpcl-core.css").read_text()
    style_block = "<style>\n" + font_face_css() + "\n" + core + "\n</style>"
    logo_uris = {k: "data:image/png;base64," + b64(ASSETS / v) for k, v in LOGOS.items()}

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    # The spec Claude reads when the system is attached, plus the raw tokens.
    (DIST / "README.md").write_text((SRC / "README.md").read_text())
    (DIST / "tokens.css").write_text(core)

    written, cards = [], []
    for page in sorted(PAGES.glob("*.html")):
        if page.name not in LAYOUT:
            sys.exit(f"page not in LAYOUT: {page.name}")
        rel, group, name, subtitle, vw, vh = LAYOUT[page.name]
        html = page.read_text()
        if "<!--TPCL_CORE-->" not in html:
            sys.exit(f"{page.name}: missing <!--TPCL_CORE--> placeholder")

        # Logos: collapse repeated <img src="{{LOGO_*}}"> into one CSS class per cut, so a
        # page that shows the mark nine times still carries the PNG bytes once. Email is
        # exempt — Gmail and Outlook drop CSS background images, so it keeps a real <img>.
        page_style = style_block
        if page.name not in EMAIL_PAGES:
            used = {k for k in LOGOS if k in html}
            marks = "".join(
                ".tp-mark--%s{background-image:url(%s);}" % (k[7:-2].lower(), logo_uris[k])
                for k in sorted(used)
            )
            if marks:
                page_style = page_style[: -len("</style>")] + marks + "</style>"
            html = LOGO_IMG_RE.sub(_img_to_mark, html)
        html = html.replace("<!--TPCL_CORE-->", page_style)
        for k, uri in logo_uris.items():   # any remaining raw uses (email)
            html = html.replace(k, uri)
        # ESP merge tags are meant to survive to the output — everything else is a bug.
        leftover = set(re.findall(r"\{\{[A-Z_]+\}\}", html)) - MERGE_TAGS
        if leftover:
            sys.exit(f"{page.name}: unresolved placeholders {set(leftover)}")
        # @dsCard marker must be the very first line of the file
        marker = f'<!-- @dsCard group="{group}" -->\n'
        if not html.lstrip().startswith("<!-- @dsCard"):
            html = marker + html
        target = DIST / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html)
        written.append((rel, len(html)))
        cards.append({"name": name, "path": rel, "subtitle": subtitle, "group": group,
                      "viewport": {"width": vw, "height": vh}})

    (DIST / "_cards.json").write_text(__import__("json").dumps(cards, indent=2))

    total = sum(s for _, s in written)
    for rel, size in written:
        print(f"  {size/1024:7.1f} KB  {rel}")
    print(f"\n{len(written)} pages · {total/1024/1024:.2f} MB total → {DIST}")


if __name__ == "__main__":
    main()
