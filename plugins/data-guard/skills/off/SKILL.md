---
name: off
description: Switch Data Guard off for the rest of this Claude Code session, with a reason that's logged. Typed by the user, e.g. /data-guard:off testing against the test tenant with fictional data.
argument-hint: <why>
disable-model-invocation: true
---

The user typed `/data-guard:off` with the reason in ARGUMENTS below.

Data Guard acted on it before you saw this, and its note in your context says what
happened. Tell the user in one line:

- **Switched off:** say so with their reason, and that `/data-guard:on` or `/clear`
  turns it back on. The status line turns magenta.
- **Nothing changed:** there was no reason, or the reason carried customer data. Pass on
  what the note says to type.
- **No note at all:** Data Guard didn't see the command, so nothing changed. Ask what
  the status line says (a red line means bigmac can't be reached).

Don't run anything to switch Data Guard yourself. Only a message the user sends counts.
