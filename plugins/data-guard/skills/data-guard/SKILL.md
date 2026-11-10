---
name: data-guard
description: TrueNorth's Data Guard, which checks Claude Code prompts and tool output for customer data under organisation policy. Use when the user types /data-guard allow, off, on or test-data, asks whether Data Guard (or DLP, or the customer-data scanner) is on, why a prompt or tool call was blocked or output redacted, what the status line means, how to switch it off while testing with fictional or test data, or what is exempt.
---

# Data Guard

TrueNorth policy sends every prompt and tool call in Claude Code to Data Guard,
a scanner on bigmac. It stops prompts that contain customer data and swaps
customer data in tool output for stand-ins such as `Person_1a2b`, `Client_1a2b`,
`contact-1a2b3c@redacted.invalid`, `07700 900123` or `QQ123456C`. It's set for
the whole organisation, so nobody can remove it in their own settings.

It checks data, not code: prompts, shell output, web pages, MCP tools, and
files such as logs, exports, JSON, CSV and Markdown notes. Source files inside the project
(read with Read, or searched with Grep) aren't checked, because they go to git
anyway. Names it only guesses at don't block a prompt. For test data, suggest
addresses at `example.com` or a `.test` domain, values it never treats as real,
such as `QQ123456C` and `07700 900123`, and for made-up people the surname
Example (`Priya Example`, `Tom Example`): Data Guard leaves anyone called Example
alone, wherever they turn up.

Company names count as customer data too. Our clients and their contacts come
from the PSA and are caught anywhere. In CRM output, every account's name is
treated as a client's (a client's own customers live there). Any other company
the name model spots becomes a `Client_1a2b` stand-in when other customer data
sits next to it, and is only logged on its own or in a prompt. The tools we use,
such as Microsoft, GitHub and Azure, are left alone.

## Skipping a flag, or switching it off

The user types these themselves, as their own message, with a reason:

```
/data-guard allow it's the example NI number from the test spec
/data-guard off testing against the test tenant with fictional data
/data-guard on
/data-guard test-data tests/fixtures/people.csv made-up people for the import tests
```

- **`allow <why>`** lets the last thing Data Guard flagged in this session
  through **once**: the user's blocked prompt when they send it again, or your
  denied or redacted tool call when you run it again. It covers that flag only;
  new data is still checked.
- **`off <why>`** switches Data Guard off for **the rest of this session**.
  `/clear` starts a new session and brings it back, as does `/data-guard on`.
- **`test-data <file> <why>`** vouches for a file of made-up data. Read the
  whole file straight after (no offset or limit): Data Guard keeps a fingerprint
  of its content, never the content. From then on names, companies, addresses
  and client names in exactly that content are left alone, in any session and
  however it's read. NI and card numbers, secrets, and real email addresses and
  phone numbers are still checked. Any edit ends the mark; mark it again after.
  Quote a path with spaces.

Data Guard sees the message before you do, acts on it, logs who and why, and
adds a note to your context saying what happened. Follow that note: tell the
user in a line, and if it says to, run the tool call again or ask them to
resend their prompt. Without a reason, nothing changes and the note says so.

You can't do this for the user: only a message they send counts. If they ask
in other words, tell them what to type. Don't run anything that tries to switch
it, and never suggest it unless the data really might be fictional.

## Checking it

```bash
python "<skill dir>/guard.py" status --path "<project folder>"
```

`<skill dir>` is this skill's base directory, which Claude Code shows when the
skill loads; `guard.py` sits next to this file. Use `python3` on macOS.

| Status line | Meaning |
|---|---|
| Green `● Data Guard on …` | Checking and redacting. |
| Yellow `● Data Guard watching …` | Audit mode: it logs, changes nothing. |
| Magenta `○ Data Guard off for this session …` | The user switched it off. `/clear` brings it back. |
| Magenta `○ Data Guard off for this project …` | An admin exempted this folder for a while. |
| Red `WARNING: can't reach Data Guard …` | Nothing is being checked. Usually Tailscale is off or on another tailnet. |

Green and yellow lines can carry this session's counts, such as
`· 128 checks, 40 ms avg · 3 redacted, 1 blocked`. A check is one prompt, tool
call or tool output; ms avg is the scanner's own time per check; redacted means
an output got stand-ins, blocked means a prompt wasn't sent, a tool call was
denied or an output was withheld. In audit mode they read "would have". They're
counts only, and start again with each session or when the scanner restarts.

## Blocked or redacted

Explain what Data Guard did, from the message it gave. Don't try to get round
it, for example by encoding, splitting or re-reading the data another way. If
the data is fictional or test data, the user can type `/data-guard allow <why>`
for that one item, or `/data-guard off <why>` for the session.

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
