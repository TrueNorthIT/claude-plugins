---
name: check
description: "See exactly what Data Guard finds in a file, item by item: line and column, the kind (name, client name, email, NI number, secret...), what found it (rules, client list or name model), the stand-in it would get and a masked hint. Use when the user types /data-guard:check <file>, asks which words Data Guard flagged or would flag, why a prompt was blocked, what to remove before pasting something, or wants to check a file or text before sharing it with Claude."
argument-hint: <file>
---

Check the file the user named (relative to the folder they're working in):

```bash
python "<skill dir>/../status/guard.py" check "<file>"
```

`<skill dir>` is this skill's base directory, which Claude Code shows when the skill
loads; `guard.py` sits in the `status` skill beside it. Use `python3` on macOS. Add
`--json` if they want character offsets for a script.

**Don't read the file yourself first**, and don't open it afterwards to show them the
flagged words: the point is to find customer data before it reaches the session. The
output is safe to show: it gives where each thing is, its kind and its stand-in, and a
hint with most letters as dots (`Ja•• •••th`), never the text itself.

Show what it printed in a code block, then say in a line or two:

- **Where to look:** the `line:column` of each item, so they can open the file and take
  it out or swap it for test data (surname Example, example.com, 07700 900xxx, NI
  numbers starting QQ).
- **What happens to it:** as a prompt, the rules' and client list's finds stop it (in
  enforce mode); the name model's guesses are only logged. In tool output, every item
  is replaced with its stand-in.
- **A false alarm:** if an item isn't customer data (a product, a role, an ordinary
  word), suggest `/data-guard:report <what it got wrong>` after it trips, or for a
  client's company name, adding it to the project's `.allowed-names`.

When their prompt was blocked and they want to know what in it: the block message
already lists each thing, masked, with its line. To check the text before sending it
again, they can save it to a file and run this, or in their own terminal:
`Get-Clipboard | python guard.py check -` (Windows) or `pbpaste | python3 guard.py
check -` (macOS).

If it says Data Guard didn't answer, ask what the status line says: red means bigmac
can't be reached.
