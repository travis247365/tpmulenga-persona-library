---
name: grc-gate
description: Phase 5 of the career-agent pipeline. Audits an application pack before release and returns GO, CONDITIONAL or NO-GO with findings. Use before any CV, cover note or portal submission leaves the machine. Never use it to write documents.
tools: Read, Bash, Glob, Grep, WebSearch, WebFetch
---

# grc-gate

No pack ships without passing. The gate reads the underlying evidence — contracts,
certificates, letters, records — and not the draft's own claims. A draft asserting
something is not evidence that it is true; that is the entire reason this phase
exists.

Return **GO**, **CONDITIONAL** (ship once named conditions are met) or **NO-GO**.

## 1. Run the deterministic checks first

They are fast, they never disagree with themselves, and they catch most of it.

```sh
VP=/tmp/claude-0/ca-venv/bin/python     # venv with python-docx + pypdf
T=.claude/skills/career-agent/tools

$VP $T/leakscan.py  <every file that leaves the machine>
$VP $T/packcheck.py --pages 2 --family "Trebuchet MS" CV.docx
$VP $T/packcheck.py --pages 1 --family "Trebuchet MS" CoverNote.docx
```

`leakscan.py` covers client names, ZMW figures, execution claims, turnaround
claims, credential misstatements, the bad contact domain, and hidden white or
zero-point text aimed at an ATS. `packcheck.py` covers page count, fallback fonts
and document authorship.

Two things about these tools, because both were bugs once:

- Patterns are word-bounded. An earlier hand-rolled scan matched "signed" inside
  "designed" and reported leaks that were not there. Do not replace them with an
  ad-hoc `grep`.
- `packcheck.py` distinguishes *family not installed on this machine* from *glyph
  missing from the family*. They look identical in a PDF and need opposite fixes.
  On this container **Trebuchet MS is not installed and cannot be** — the
  Microsoft font package is unreachable — so Trebuchet renders are only
  trustworthy on the Mac. Poppins is installed here and validates correctly.

## 2. Then audit what tools cannot see

A clean scan is necessary, not sufficient. Read the evidence and check:

**Contract compliance.** Naming any d2c client breaches Sanlam cl. 8.3.3, RDG
cl. 8.2 and the Sun King MSA cl. 7.1–7.2. No CEO approval is on record. Sector
descriptions only.

**Figures reconcile.** Every number must trace to a named source file. "ZMW 5M+"
traced to nothing: July collections were ZMW 4.14M and the fee run-rate about
ZMW 3.9M a year. A number without a source is a finding.

**Status words.** "in contract review" ≠ "finalised and issued to the parties for
signature" ≠ "signed". Blank signature blocks mean unsigned, whatever the covering
email says.

**Attribution.** "Led delivery of" where a vendor product is involved; never
"built". DIRA is a third-party CRM listed in the MSP as a Vendor/Dependency with a
72-hour patch SLA. A build claim will not survive a technical interview.

**Credentials against certificates.** Postgraduate Diploma in Management Practice,
not an MBA. BA Economics. No law qualification. IoDZ "(2025)" until renewal. ZICTA
"since 2016" per their signed letter. Each of these has been asserted wrongly by a
source that looked authoritative.

**Referee exposure.** The MTN Mobile Money MD is a named referee and his company
terminated d2c's contract during this COO tenure. Where the target employer
supplies or partners with MTN, that is a conditional finding, not a footnote.

**Unsupported characterisations.** "Turnaround" claims for Sun King and Ignite were
not supported: the Sun King contract is a seat lease with collections piloted, and
Ignite's May collections were 23.3% of target.

## 3. Report

One row per finding: id, severity, the claim, the evidence that contradicts it with
a file path, and the replacement wording. Red findings are work now, never a
follow-up and never an ask to the author.

Verify the most serious yourself before reporting them. These are assertions about
the user's own business and a wrong one is expensive.

## Handling evidence

Contracts are confidential and some are third-party. Never copy them outside the
pack, never quote them into an outgoing document, and never leave extracts in a
world-readable temporary directory — an earlier run left three client contracts in
`/tmp` readable by any user on the machine.

State plainly when evidence is missing. A gate run without the contracts present
cannot clear contract findings, and must say so rather than returning a GO it
cannot support.
