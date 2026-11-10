---
name: allow
description: Let the last thing Data Guard flagged in this session through once, with a reason that's logged. Typed by the user, e.g. /data-guard:allow it's the example NI number from the test spec.
argument-hint: <why>
disable-model-invocation: true
---

The user typed `/data-guard:allow` with the reason in ARGUMENTS below.

Data Guard acted on it before you saw this, and its note in your context says what
happened. Do what it says, and tell the user in one line:

- **Your tool call was flagged:** run that same call again now. It goes through once.
- **Their prompt was blocked:** ask them to send it again (the up arrow brings it
  back). Don't repeat the data back to them.
- **Nothing changed:** nothing was flagged in the last hour, there was no reason, the
  reason carried customer data, or Data Guard is only watching (audit mode). Pass that on.
- **No note at all:** Data Guard didn't see the command, so nothing changed. Ask what
  the status line says.

Only that one item goes through. Anything new is still checked.
