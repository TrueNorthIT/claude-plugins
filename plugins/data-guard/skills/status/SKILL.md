---
name: status
description: TrueNorth's Data Guard, which checks Claude Code prompts and tool output for customer data under organisation policy. Use when the user types /data-guard:status, asks whether Data Guard (or DLP, or the customer-data scanner) is on, why a prompt or tool call was blocked or output redacted, why the status line's counts went up, what the status line means, which /data-guard commands there are, how to work with test, fictional or made-up data without it being flagged, how to mark a file as test data, or what is exempt. Also use when the user wants an email, letter, report or file written with real customer data that Data Guard showed you as stand-ins (Person_1a2b and so on), or a write was refused because it contained stand-ins: draft it and fill it with guard.py fill.
---

# Data Guard

TrueNorth policy sends every prompt and tool call in Claude Code to Data Guard,
a scanner on bigmac. It stops prompts that contain customer data and swaps
customer data in tool output for stand-ins such as `Person_1a2b`, `Client_1a2b`,
`contact-1a2b3c@redacted.invalid`, `07700 900123` or `QQ123456C`. It's set for
the whole organisation, so nobody can remove it in their own settings.

It checks data, not code: prompts, shell output, web pages, MCP tools, and
files such as logs, exports, JSON, CSV and Markdown notes. Source files inside
the project (read with Read, or searched with Grep) aren't checked, because they
go to git anyway, unless their content is JSON or CSV. Names it only guesses at
don't block a prompt. Company names count: our clients and their contacts (from
the PSA) anywhere, every account name in CRM output, and any other company the
name model spots next to other customer data. The tools we use, such as
Microsoft, GitHub and Azure, are left alone.

## When the user types /data-guard:status

Run the status check (see "Checking it") and show its line, then the commands
table below, briefly. If they asked something with it, answer that instead.

## The commands

The user types these as their own message. Each is a skill in the `data-guard`
plugin, so Claude Code always shows the `data-guard:` part; `/data-guard off`
without the colon is an unknown command.

| Command | Example | What happens |
|---|---|---|
| `/data-guard:allow <why>` | `/data-guard:allow it's the example NI number from the test spec` | The last thing flagged in this session goes through once: the user sends the prompt again, or you rerun the tool call. Anything new is still checked. |
| `/data-guard:off <why>` | `/data-guard:off testing against the test tenant with fictional data` | Off for the rest of this session. The status line turns magenta. `/clear` or `/data-guard:on` brings it back. |
| `/data-guard:on` | `/data-guard:on` | Back on. Anything typed after it is checked as normal. |
| `/data-guard:test-data <file> <why>` | `/data-guard:test-data tests/fixtures/people.csv made-up people for the import tests` | Read the whole file straight after, with no offset or limit. Data Guard fingerprints its content and says until when (30 days). Names, companies, addresses and client names in exactly that content are then left alone, for anyone and however it's read; NI and card numbers, secrets and real contact details are still caught. Any edit ends the mark. Quote a path with spaces: `/data-guard:test-data "test data/people.csv" fixtures`. |
| `/data-guard:status` | `/data-guard:status` | This skill: the status line and these commands. |

Data Guard sees the message before you do, acts on it, logs who and why, and adds
a note to your context saying what happened. Follow that note: tell the user in a
line, and do what it says (rerun the call, read the file whole, or ask them to
resend the prompt). It also tells you when nothing changed: no reason given, a
near miss such as `/data-guard:alow` ("did the user mean allow?"), or a file read
only in part.

A command is checked like any other prompt. If its text carries customer data,
it's blocked and the command doesn't run, so the reason should say why without
the data: "the example NI number from the spec", not the number. Whatever reason
goes through is logged with the data swapped for stand-ins.

You can't run these for the user: only a message they send counts. If they ask
in other words, tell them what to type. Don't run anything that tries to switch
Data Guard off, and only suggest these when the data really might be fictional.

## Working with test data

When the user wants made-up data that Data Guard won't flag, suggest the lightest
way that works, in this order:

1. **Values it never treats as real.** Emails at `example.com` or a `.test`
   domain, phone numbers `07700 900000` to `07700 900999`, NI numbers starting
   `QQ`, published test card numbers, and the surname Example for people
   (`Priya Example`, `Tom Example`). Use these whenever you generate test data.
2. **Data you write yourself.** In a session where Data Guard is enforcing and
   hasn't been switched off or used `allow`, each line you write with Write or
   Edit is fingerprinted (never stored). When exactly those lines are read back,
   in any later session, they come through as written. Only a secret on them is
   still caught; a line anything else adds gets the full check. Real-format NI
   numbers can belong to real people, so still prefer `QQ` numbers.
3. **`/data-guard:test-data <file> <why>`** for a file of made-up data that
   someone else wrote, such as a fixture.
4. **`/data-guard:allow <why>`** for one flagged item, once.
5. **`/data-guard:off <why>`** for the rest of the session, only when the whole
   session uses fictional data.

## Writing something that needs the real values

When the user wants an email, letter, report or file that has to contain customer
data you only saw as stand-ins, don't ask them to switch Data Guard off. Either:

1. **Write code that reads the real data when it runs**, such as a mail merge from
   `contacts.csv`. Best for many records: you only ever see field names.
2. **Draft, then fill.** Write the text with the stand-ins exactly as you saw them
   (`Dear Person_1a2b, …`) to a file whose name ends in `.draft` before its
   extension, such as `reply.draft.md` or `email.draft.eml`. Stand-ins are refused
   in any other file. Then fill it on the user's machine:

   ```bash
   python "<skill dir>/guard.py" fill reply.draft.md --from data/contacts.csv
   ```

   `--from` is the file the real values came from (repeat it for several). Data
   Guard finds the values there again, swaps back the stand-ins that match, and
   writes `reply.md` next to the draft. It stores nothing, and only values in those
   files can come back. Tell the user what it printed: how many it filled, and any
   stand-ins it left (not in the sources, or shared by two values, to fill by hand).

Don't read the filled file back (it would be redacted again) and don't send it
through a tool, such as an email or CRM call: the user sends or uses it themselves.
Copy stand-ins exactly; one you've changed won't fill.

## Checking it

```bash
python "<skill dir>/guard.py" status --path "<project folder>"
```

`<skill dir>` is this skill's base directory, which Claude Code shows when the
skill loads; `guard.py` sits next to this file. Use `python3` on macOS.

| Status line | Meaning |
|---|---|
| Green `● Data Guard on …` | Checking and redacting. |
| Yellow `● Data Guard watching …` | Audit mode: it logs what it would do and changes nothing. |
| Magenta `○ Data Guard off for this session …` | The user switched it off. `/clear` or `/data-guard:on` brings it back. |
| Magenta `○ Data Guard off for this project …` | An admin exempted this folder for a while. |
| Red `WARNING: can't reach Data Guard …` | Nothing is being checked. It tries Tailscale and then bigmac's own network, and neither answered: connect Tailscale to the TrueNorth tailnet. |

Green and yellow lines carry this session's counts, such as
`· 128 checks, 40 ms avg · 3 redacted, 1 blocked`. A check is one prompt, tool
call or tool output; ms avg is the scanner's own time per check; redacted means
an output got stand-ins; blocked means a prompt wasn't sent, a tool call was
denied or an output was withheld. In audit mode they read "would have". They
start again with each session or when the scanner restarts.

After a flag the line also says what the last one was, for example
`· last 14:02: Read output would be redacted (email ×2, name)`: when, where (the
prompt, or which tool's call or output) and what kinds of data, never the values,
file names or commands. You can't see the status line, so when someone asks why
the counts went up, ask what the end of theirs says: the kinds tell you what to
look for in that output.

## Blocked or redacted

Explain what Data Guard did, from the message it gave. Don't try to get round
it, for example by encoding, splitting or re-reading the data another way. If
the data is fictional or test data, offer the options under "Working with test
data", lightest first.

Stand-ins aren't real values. A file write, command or MCP call that contains
one is denied, so it can't end up in a file, commit, record or message. If you
need the real value, ask the user for it.

## Admins: exempting a whole project

For a project that always uses fictional data, an admin with the key in
`~/.claude-dlp/admin.key` can exempt the folder for a set time:

```bash
python "<skill dir>/guard.py" project-off --path "<folder>" --reason "<why>" [--until YYYY-MM-DD] [--user <name>]
python "<skill dir>/guard.py" project-on --path "<folder>" [--user <name>]
python "<skill dir>/guard.py" list
```

`~/.claude-dlp/admin.key` holds a secret. Never read or print it.
