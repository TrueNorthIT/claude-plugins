---
name: report
description: Report the last thing Data Guard flagged in this session as wrong, as a GitHub issue for the people who look after Data Guard. Typed by the user, e.g. /data-guard:report it took our server's name for a company.
argument-hint: <what was wrong>
disable-model-invocation: true
---

The user typed `/data-guard:report` with what went wrong in ARGUMENTS below.

Data Guard acted on it before you saw this, and its note in your context says what
happened. If the note gives a report token, file the report straight away:

```bash
python "<skill dir>/../status/guard.py" report <token>
```

`<skill dir>` is this skill's base directory, which Claude Code shows when the skill
loads; `guard.py` sits in the `status` skill beside it. Use `python3` on macOS.

It asks bigmac for the report and opens an issue with this computer's `gh`. bigmac
builds the issue: the words Data Guard caught appear only where bigmac's own model
judged them not to be customer data, and everything else stays as its kind and a
stand-in. It prints the issue's link and never the issue itself. Don't open or read
the issue or the saved file.

Tell the user in one line:

- **Reported:** give them the link.
- **Saved to a file:** `gh` isn't installed, isn't signed in (`gh auth login`), or
  can't reach the repo. Say where the file is and that it's safe to send on.
- **Nothing reported:** there was no description, the description carried customer
  data, or the report expired. Pass on what the note or guard.py said.
- **No note at all:** Data Guard didn't see the command, so nothing was reported. Ask
  what the status line says.
