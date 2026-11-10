# TPCL Design System — how to use it

**v1.0 · built 4 August 2026**

Two ways in: **Claude Design** (no code, for you or anyone you hand it to) and **Claude Code**
(the `/tpcl-brand` skill, for builds that produce files).

---

## 1. Claude Design — the code-free path

The system is live as a design-system project on your claude.ai account.

1. Go to **claude.ai/design**.
2. In the prompt bar, open the **"Design system"** dropdown (it currently reads *None*).
3. Choose **TPCL — Travis Paul Consulting**.
4. Type what you want. Claude reads the tokens, motif rules and templates before it draws anything.

Leave the **Template** dropdown on *None*. That picker holds Anthropic's own starter layouts; the
TPCL templates are cards inside the design system, and you point at them by name in the prompt
("use the WhatsApp Status template").

**What's in the pane**

| Group | Cards |
|---|---|
| Foundations | Colour · Typography · Logo & lockups · Motifs · Layout & spacing |
| Components | Buttons · Cards & panels · Stat tiles & KPI row · Timeline & steps · Tables, quotes & tags |
| Templates · Social | IG/FB square 1080 · IG/LinkedIn portrait 1080×1350 · Story/Reel 1080×1920 · **WhatsApp Status 1080×1920** |
| Templates · LinkedIn | Single image 1200×627 · Carousel 1080×1350 · Banners 1584×396 + 1128×191 |
| Templates · Email | Newsletter 600px (table-based) |
| Templates · Website | Hero · Sections |
| Templates · Deck | Slide masters 16:9 |

Everything is self-contained: Poppins is embedded as subset WOFF2 and the Travis Paul Consulting
signature is embedded as a data URI, so nothing breaks under Claude Design's no-external-requests
policy — and nothing depends on fonts being installed on the viewer's machine.

---

## 2. Prompt library

Paste these straight in with the design system selected. Replace the **bold** parts.

### Social

> Build an **Instagram square, 1080×1080** post using the TPCL dark statement layout.
> Headline: **"Three in ten accounts carry the arrears"**. Hero figure: **31.4%, PAR 30+, July 2026**.
> Source line: **measured, portfolio extract**. Keep the headline to seven words or fewer.

> Build an **Instagram/LinkedIn portrait, 1080×1350** post in TPCL light mode.
> Topic: **why contact rate is the wrong KPI**. Three KPI tiles: **+6.1 pts collection rate,
> −18% calls per recovery, 8 months measured**. Include the single-stroke cyan sparkline.
> Bold only the phrase that carries the argument.

> Build a **WhatsApp Status, 1080×1920**, TPCL light mode. One idea: **"Seven in ten PayGo customers
> pay late, not never."** Hero figure **72% recovered within 60 days**. Amber CTA reading
> **"Full note in bio"**. Respect the WhatsApp safe zones — top 260px and bottom 320px stay clear —
> and delete the dashed guides before you show me the export.

> Build a **Story/Reel cover, 1080×1920**, TPCL dark. Headline **"Build. Model. Defend."** with the
> three numbered step boxes. Keep everything inside the middle 1420px.

### LinkedIn

> Build a **LinkedIn single image post, 1200×627** using the TPCL split layout — charcoal left with
> the claim, blue-gray right with the proof. Claim: **"Order the book before you call it"**.
> Proof: **+6.1 pts collection rate over 8 months, 48,120 accounts**. No divider line between the blocks.

> Build a **9-page LinkedIn carousel, 1080×1350**, on **why contact rate is the wrong KPI**.
> Dark cover → light content pages → dark CTA. One idea per page, index chip on every page,
> no body copy on the cover, no data on the CTA. Then give me the pages ready to combine into a PDF.

> Build my **LinkedIn personal banner, 1584×396**, TPCL dark. Tagline **"Evidence before advice"**,
> strapline **"CVM · Collections · Data & AI products · Lusaka, Zambia"**.
> Keep all type clear of the avatar keep-out in the lower left.

### Email

> Build a **TPCL email newsletter, 600px**, table-based and Outlook-safe.
> Subject/headline: **"Your collections book does not have a contact problem."**
> Include the blue-gray three-up KPI strip, a cyan pull-quote, and one CTA.
> Remind me to swap the logo for a hosted https URL before I send.

### Website

> Build the **TPCL website hero** at 1440 — 7/5 split, charcoal claim left, blue-gray proof right,
> charcoal nav above it, one primary action. Then the **sections** beneath it: services, a dark
> statement band, proof with a provenance-tagged table, a blue-gray CTA band and the charcoal footer.

### Deck

> Build **TPCL slides at 1920×1080** for **[topic]**, using the four masters: dark cover, split
> dark/blue-gray, white content with a table and a "so what" card, and a dark statement page for the
> commercial ask. Caps on charcoal, sentence case on white.

### Client-overlay work

> Build **[surface]** for the **[client]** engagement. Use the TPCL system with the client overlay:
> tint `--tp-client` to **[hex]** and use the client logo in the co-brand lockup — TPCL left, client
> right. Keep the charcoal/white frame, Poppins and the motifs TPCL. Check the client colour's
> contrast against charcoal and white before using it as text.

### Useful follow-ups

- *"Show me the light-mode version of that."*
- *"Strip the safe-zone guides and give me the export-ready frame."*
- *"That total doesn't reconcile — recheck it against 128,890,976."*
- *"Too many motifs. Keep the accent block and the signature, drop the rest."*
- *"Tag every figure as measured, modelled or assumed."*

---

## 3. Claude Code — the `/tpcl-brand` skill

Installed at `~/.claude/skills/tpcl-brand/SKILL.md`. Invoke with **`/tpcl-brand`**, or just ask for
TPCL-branded work and it loads itself. Use this path when the output is a **file** — a PPTX, a PNG
set for scheduling, a PDF carousel, a website repo — rather than something you look at in a browser.

---

## 4. Rebuilding after an edit

Sources live in `src/`; `dist/` is generated and should never be hand-edited.

```bash
cd ~/Desktop/TPCL_Design_System
python3 build_tpcl_ds.py          # inlines fonts + logos, writes dist/
```

Then push the changed files back to the Claude Design project — ask Claude Code to
"sync the TPCL design system to Claude Design" and it will diff and upload.

To change a token everywhere, edit **`src/tpcl-core.css`** only. To change the written spec Claude
reads, edit **`src/README.md`**. Both propagate on rebuild.

---

## 5. What was decided (the brief's open questions, closed)

The 2026 design brief left six decisions open. These are the answers baked into v1.0:

1. **Logo** — the handwritten *Travis Paul* signature with CONSULTING caps. Consulting by default.
2. **Background** — pure white `#FFFFFF`. Not the off-white `#F9F9F7` from the older template guide.
3. **Accents** — cyan + amber, deck-accurate, with a single-variable client overlay on top.
4. **Case** — keep the split: ALL CAPS on charcoal, sentence case on white.
5. **Typography** — Poppins throughout, superseding the brief's Inter/Montserrat guess.
6. **Confidentiality footer** — not included; it was in the older template guide, not the deck.

Two things v1.0 adds that the brief did not cover, because the work needs them: **measured contrast
rules** (which is where the "charcoal on cyan, never white" rule comes from) and **provenance
chips** on every figure.

---

## 6. Known limits

- **Email cannot use the embedded font or the embedded logo.** Gmail strips `@font-face`; Gmail and
  Outlook both drop data-URI images. Host the logo and accept the Century Gothic / Arial fallback.
- **Poppins ships as a Latin subset** (~7.6 KB per weight). Adding a language with different glyph
  coverage means re-running the subset step in `build_tpcl_ds.py` with a wider unicode range.
- **Safe-zone bands are drawn guides, not enforcement.** They are marked `.tp-noexport` and must be
  deleted before an export; nothing stops you exporting with them visible.
- **The logo cuts are raster PNG at 760px wide.** Fine to about 700px on screen. For large print,
  go back to the `.ai`/`.eps` masters in `iCloud Drive / TPCL PTHL LOGOS.zip`.
