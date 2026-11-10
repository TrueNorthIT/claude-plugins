---
name: test-data
description: Mark a file of made-up data as test data for 30 days, so Data Guard leaves its names, companies and addresses alone. Typed by the user, e.g. /data-guard:test-data tests/fixtures/people.csv made-up people for the import tests.
argument-hint: <file> <why>
disable-model-invocation: true
---

The user typed `/data-guard:test-data` with the file and the reason in ARGUMENTS below.

Data Guard acted on it before you saw this, and its note in your context says what
happened.

- **Marked:** read the whole file now with the Read tool, with no offset or limit.
  Data Guard fingerprints its content on that read (never the content itself) and
  tells you until when it's marked. Tell the user that in one line.
- **Nothing changed:** the file or the reason was missing. Pass on what the note says
  to type. A path with spaces needs quotes: `/data-guard:test-data "test data/people.csv" fixtures`.
- **No note at all:** Data Guard didn't see the command. Ask what the status line says.

Once it's marked, names, companies, addresses and client names in exactly that
content are left alone, for anyone and however it's read. NI and card numbers,
secrets and real email addresses and phone numbers are still caught. Any edit to the
file ends the mark.
