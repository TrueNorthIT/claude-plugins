# data-guard

TrueNorth policy sends every prompt and tool call in Claude Code to Data Guard,
a scanner on bigmac. It stops prompts that contain customer data and swaps
customer data in tool output for stand-ins before Claude sees it. It's set for
the whole organisation in the Claude admin console, which also installs this
plugin for everyone.

| You want to | Do this |
|---|---|
| Know what it's doing | Look at the status line ([below](#what-the-status-line-says)), type `/data-guard:status`, or ask Claude "what's Data Guard doing?" |
| Test with made-up data | Ask Claude to generate it with reserved values ([Test data](#test-data)). Nothing to switch off. |
| Use a file of made-up data someone else wrote | `/data-guard:test-data <file> <why>` |
| Let one false alarm through | `/data-guard:allow <why>` |
| Work with fictional data all session | `/data-guard:off <why>`, and `/data-guard:on` after |
| Write an email or file with the real values Claude only saw as stand-ins | Claude drafts it as `reply.draft.md`, then `guard.py fill` puts the real values in on your machine ([Draft, then fill](#draft-then-fill)) |
| Fix a red status line | Connect Tailscale to the TrueNorth tailnet. While it's red, nothing is checked. |

## Commands

You type these yourself, as a message, with a reason. Claude can't run them for
you. Each is its own command in this plugin, so type the `data-guard:` part too:
Claude Code doesn't know `/data-guard off`. Type `/data-guard:` and the menu
lists them with what each one needs. Every command is logged with your name and
reason. `/data-guard:status` shows the status line and the commands.

### Let one false alarm through: `allow`

Data Guard blocked your prompt, or redacted an output, and it isn't real
customer data:

```
/data-guard:allow it's the example NI number from the HMRC test spec
```

Then send your prompt again (the up arrow brings it back), or let Claude rerun
the tool call. Only that one item goes through, once; anything new is checked.

### Switch off for a session: `off` and `on`

You're working against the test tenant with fictional data all afternoon:

```
/data-guard:off testing the import against the test tenant, fictional data only
```

The status line turns magenta for the rest of the session. Turn it back on with
`/data-guard:on`, or start a new session with `/clear`. Anything Claude writes
while it's off isn't trusted later (see [Test data](#test-data)).

### Vouch for a file of made-up data: `test-data`

A fixture file of fake people keeps getting flagged:

```
/data-guard:test-data tests/fixtures/people.csv made-up people for the import tests
```

Claude then reads the whole file, and Data Guard tells it the file is marked and
until when (30 days). From then on, names, companies, addresses and client names
in exactly that content are left alone, for anyone, whether it's opened with Read
or printed with `cat`. NI and card numbers, secrets, and real email addresses and
phone numbers are still caught. Change the file and the mark ends; mark it again
after. Quote a path with spaces:

```
/data-guard:test-data "test data/people.csv" fixtures for the CRM sync tests
```

Bigmac keeps a fingerprint of the content, never the content.

### Getting it wrong is fine

- **No reason:** nothing changes, and Claude tells you to add one.
- **A typo:** Claude Code answers `/data-guard:alow …` with "Unknown command" and
  sends nothing. Pick the command from the menu instead.
- **Customer data in the reason:** `/data-guard:allow it's Jane Doe's NI AB123456C`
  is blocked like any prompt, and the command doesn't run (in audit mode it's
  logged and runs). Say why without the data:
  `/data-guard:allow it's the example NI number from the spec`.
- **Only part of the file read:** Claude is told the file isn't marked yet and to
  read it whole.

## Draft, then fill

Claude sees customer data as stand-ins, so anything it writes has stand-ins too. When you need
the real values in the result, such as a reply to a customer, ask Claude to draft it:

> Draft a reply to the escalation in data/escalation.txt as replies/reply.draft.md.

A file whose name ends in `.draft` before its extension is the one place a stand-in may be
written. Then ask Claude to fill it from the file the values came from. It runs the skill's
`guard.py` on your machine:

```
python guard.py fill replies/reply.draft.md --from data/escalation.txt
```

```
Filled 4 stand-in(s) into replies/reply.md. It holds real customer data: send or use it yourself, and don't paste it back to Claude.
```

Data Guard finds the values in `--from` again, recomputes their stand-ins and swaps back the
ones that match. It stores nothing, so only values in files you already have can come back. A
stand-in that isn't in the sources, or that two values share, is left for you to fill by hand,
and listed. For many records, ask Claude for a script that reads the real file when it runs
instead, such as a mail merge.

## Test data

Made-up data shouldn't be flagged; real data should. From least effort to most:

1. **Reserved values, never treated as real.** Emails at `example.com` or a
   `.test` domain, phone numbers `07700 900000` to `07700 900999`, NI numbers
   starting `QQ`, published test card numbers, and the surname Example for
   people. Ask for them, for example:

   > Generate 20 test customers for `seed.csv`: surname Example, emails at
   > example.com, phones from 07700 900, NI numbers starting QQ.

2. **Data Claude makes up itself.** When Data Guard is enforcing and you haven't
   used `off` or `allow` in the session, every line Claude writes to a file is
   fingerprinted. Read it back in any later session and those lines come through
   as written, realistic names, emails and invented NI numbers included. Only a
   secret on them is still caught, and any line something else adds gets the full
   check. (In audit mode nothing is recorded yet.) Prefer `QQ` NI numbers anyway:
   a made-up number in a valid format can belong to a real person.

3. **`/data-guard:test-data <file> <why>`** for a file Claude didn't write, such
   as a fixture from a colleague.

4. **`/data-guard:allow` or `off`** when none of those fit.

## What it checks

It checks data, not code: your prompts, shell output, web pages, MCP tools,
and files such as logs, exports, JSON, CSV and Markdown notes. Source files in
your project aren't checked, because they go to git anyway, unless what's in
them is JSON or CSV (an export saved as `src/x.py` is still an export).

- **Stand-ins stay stand-ins.** Claude can't write `Person_1a2b` and the like
  into a file, command, commit or record. If it needs the real value, it asks
  you.
- **A name on its own isn't enough.** A name the model guesses is swapped only
  next to something more certain, such as an email, phone number or client
  name, or in a list of five or more.
- **Company names count.** Our clients and their contacts, from the PSA, are
  caught anywhere, and so is every account name in CRM output. Any other company
  is swapped for a stand-in such as `Client_1a2b` when other customer data is
  next to it. The tools we use, such as Microsoft, GitHub and Azure, are left
  alone.

## What the status line says

The line at the bottom of Claude Code refreshes every 15 seconds.

| Status line | Meaning |
|---|---|
| Green `● Data Guard on · 128 checks, 40 ms avg · 3 redacted, 1 blocked` | Checking everything. |
| Yellow `● Data Guard watching (audit mode) · … · would have redacted 3, blocked 1` | Trial run: it logs what it would have done and changes nothing. |
| Magenta `○ Data Guard off for this session: <why> …` | You switched it off. `/clear` or `/data-guard:on` brings it back. |
| Magenta `○ Data Guard off for this project …` | An admin exempted this folder for a while. |
| Red `WARNING: can't reach Data Guard …` | It tried Tailscale and then bigmac's own network, and neither answered. Connect Tailscale to the TrueNorth tailnet. |

The counts are for the session you're in, and start again in a new one:

- **checks**: prompts, tool calls and tool outputs Data Guard looked at.
- **ms avg**: how long each check takes on average.
- **redacted**: outputs where customer data was swapped for stand-ins such as
  `Person_1a2b` before Claude saw them.
- **blocked**: prompts that weren't sent, tool calls that didn't run, and
  outputs that were held back.

After something is flagged, the line ends with the last flag, which answers "why
did my counts go up?":

```
● Data Guard watching (audit mode) · 214 checks, 38 ms avg · would have redacted 3 · last 14:02: Read output would be redacted (email ×2, name)
```

That's when, where (your prompt, or which tool's call or output) and what kinds
of data. It never shows the values, file names or commands.

## Installing and updating

The organisation settings install this plugin for you. If `/plugin` doesn't list
`data-guard` under Installed, install it yourself:

```
/plugin install data-guard --marketplace TrueNorthIT/claude-plugins
```

To pick up a newer version, update the `truenorthit` marketplace from `/plugin`.

Admins can also exempt a whole project folder for a set time with the admin
key. The scanner, hooks and settings live in
[TrueNorthIT/claude-code-dlp](https://github.com/TrueNorthIT/claude-code-dlp).
