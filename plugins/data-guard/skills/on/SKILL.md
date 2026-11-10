---
name: on
description: Switch Data Guard back on for this Claude Code session after /data-guard:off. Typed by the user as /data-guard:on.
disable-model-invocation: true
---

The user typed `/data-guard:on`.

Data Guard acted on it before you saw this, and its note in your context says what
happened: it's back on, or it was already on. Tell the user in one line. From here
on, every prompt and tool output in this session is checked again.

If there's no note, Data Guard didn't see the command. Ask what the status line
says (a red line means bigmac can't be reached).
