# TPCL Brand & Design System — share pack

**Travis Paul Consulting Ltd · v1.0 · August 2026**

Everything needed to produce on-brand TPCL work in claude.ai, without writing code.

---

## Start here

| Open this | For |
|---|---|
| **TPCL_Design_System_Guide.pdf** | **Read this first.** 5 pages: how to switch the design system on in claude.ai, the full prompt library, and how to judge what comes back. |
| **TPCL_Brand_Guidelines_v1.0.pdf** | The authority on what is *correct*. 9 pages: logo, colour, typography, motifs, layout, and the nine pre-flight checks. |

The guide tells you **how to make it**. The guidelines tell you **what is right**.

---

## Setting up — takes a minute, once

1. Go to **claude.ai/design**
2. Open the **"Design system"** dropdown in the prompt bar (it reads *None*)
3. Choose **"TPCL — Travis Paul Consulting"**
4. Leave **"Template"** on *None* — TPCL's templates live inside the design system, and you name them in your prompt

Then just ask, e.g.:

> Build a WhatsApp Status, 1080×1920, TPCL light mode. One idea: "Seven in ten PayGo customers pay late, not never." Hero figure 72% recovered within 60 days. Respect the WhatsApp safe zones.

Templates already built, at real export dimensions: Instagram/Facebook square and portrait,
Story/Reel, **WhatsApp Status**, LinkedIn single image, carousel and banners, a 600px email,
website hero and sections, and four 16:9 slide masters.

---

## Also in this pack

| File | What it is |
|---|---|
| `tokens.css` | The machine-readable palette, type scale, spacing and components. Hand this to a developer or agency — nothing to do with it by hand. |
| `logos/` | Travis Paul Consulting marks: white (for charcoal), black (for white), full colour (plain light grounds only). |
| `TPCL_Design_System_Spec.md` | The written spec in plain text — the same rules the PDFs cover, in a form another AI tool or developer can read directly. |
| `_source_html/` | The two PDFs as HTML, if you ever need to edit or re-export them. |

---

## The four rules people break most

1. **Where a dark and a light block meet, they meet directly — there is no divider line.**
2. **Cyan and amber fills carry charcoal labels, never white** (white on cyan is 2.30:1 and fails accessibility).
3. **CAPS on charcoal, sentence case on white.** Not one rule across the whole deck — the split *is* the system.
4. **Every figure says whether it is Measured, Modelled or Assumed**, and every total reconciles to source.

---

## Two limits worth knowing up front

- **Email cannot carry the embedded font or logo.** Gmail strips webfonts; Gmail and Outlook both drop
  embedded images. Host the logo at an https URL and accept the fallback typeface. Do not work around
  it with pictures of text.
- **Safe-zone guides are drawn, not enforced.** The dashed bands on the Story and WhatsApp templates
  mark where the app covers your artwork. Delete them before exporting.

---

Questions: Travis Mulenga · travis.mulenga@gmail.com
