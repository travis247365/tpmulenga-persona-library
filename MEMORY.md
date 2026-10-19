# Working agreements

## Autonomy
**Do not wait for me on work I asked you to build, unless I say "plan".**
Asking for approval mid-build is the exception, not the default. Deliver the
whole thing, state the assumptions you made, and flag what needs my decision
*after* the work exists — not instead of it.

The two standing exceptions, because they leave the machine or cannot be undone:
- sending mail to anyone but travis.mulenga@gmail.com (never, on any pretext)
- destructive or outward-facing actions: deleting published work, adding
  calendar attendees, pushing to a branch other than the designated one

## Truthfulness
- Credentials come from certificates, never from notes or prior drafts.
  Postgraduate Diploma in Management Practice (Henley, NQF-8) — not an MBA.
  No law qualification.
- Never insert hidden text of any kind into a document to influence an ATS.
- Client names are withheld: Sanlam cl. 8.3.3, RDG cl. 8.2, Sun King MSA
  cl. 7.1–7.2. No ZMW figures.
- "contract review" / "issued for signature" / "signed" are three different
  states, and so are "led delivery of" / "built". Do not collapse them.

## Reporting
A run that did nothing is a FAILED run, whatever status the platform returns.
Say what did not happen, in the same breath as what did.

## Brand
Travis Paul Consulting work is set in Poppins. Personal work is Trebuchet MS.

## Getting files into a cloud session
This session runs in a cloud container. It has no `/Users`, no view of the Mac,
and no access to iCloud or a local folder — only git, the connectors, and the
network. Claude Design's "send to Claude Code" seeds a **local** workspace, so
from claude.ai/code it delivers the file list as text and nothing else. Four
routes were tried on the TPCL export and all came back empty; putting it in a
repo worked in seconds.

**So: anything that has to reach a cloud session goes into a git repo.** Say so
at the first sign of a local path rather than hunting. If the work must happen
against files that cannot leave the Mac, run Claude Code on the Mac instead.

`scripts/ingest-design-system.sh` takes a repo directly for this reason:
`owner/repo`, `owner/repo@branch --path sub/dir`, or a git URL.

## Giving Travis commands to paste

**Never put `#` comments in a block meant for pasting.** His shell is zsh, and
interactive zsh does not treat `#` as a comment unless `interactive_comments`
is set, which is not the default. Every commented line comes back as
`zsh: command not found: #`. This has now happened three times in one project.
Commands only; the explanation goes in the prose above the block.

Related: a multi-line block pasted into zsh runs each line as it arrives, so a
line that fails does not stop the ones after it. Keep paste blocks short enough
that a failure is visible before the next command runs.

## Bootstrap order

A script that performs the `git pull` cannot be delivered *by* that pull. If a
new script is the entry point, the handover must start with the pull that
brings it, not with the script. Said another way: never hand over a command
whose file only exists after the command runs.
