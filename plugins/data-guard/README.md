# data-guard

TrueNorth policy sends every prompt and tool call in Claude Code to Data Guard,
a scanner on bigmac. It stops prompts that contain customer data and swaps
customer data in tool output for stand-ins before Claude sees it. It's set for
the whole organisation in the Claude admin console, which also installs this
plugin for everyone.

| You want to | Do this |
|---|---|
| Know what it's doing | Look at the status line (below), or ask Claude "what's Data Guard doing?" |
| Let one false alarm through | Type `/data-guard allow <why>`, then send your prompt again or let Claude rerun the tool. It covers that one item, and your reason is logged. |
| Work with fictional or test data | Type `/data-guard off <why>`. It's off for this session only and logged. `/clear` or `/data-guard on` brings it back. |
| Fix a red status line | Connect Tailscale to the TrueNorth tailnet. While it's red, Data Guard can't check anything. |

## What it checks

It checks data, not code: your prompts, shell output, web pages, MCP tools,
and files such as logs, exports, JSON, CSV and Markdown notes. Source files in
your project aren't checked, because they go to git anyway.

- **Stand-ins stay stand-ins.** Claude can't write `Person_1a2b` and the like
  into a file, command, commit or record. If it needs the real value, it asks
  you.
- **Test data is never flagged.** Use emails at `example.com` or a `.test`
  domain, phone numbers from `07700 900000` to `07700 900999`, and NI numbers
  starting `QQ`.
- **A name on its own isn't enough.** A name the model guesses is swapped only
  next to something more certain, such as an email, phone number or client
  name, or in a list of five or more.

## What the status line says

The line at the bottom of Claude Code refreshes every 15 seconds.

| Status line | Meaning |
|---|---|
| Green `● Data Guard on · 128 checks, 40 ms avg · 3 redacted, 1 blocked` | Checking everything. |
| Yellow `● Data Guard watching (audit mode) · … · would have redacted 3, blocked 1` | Trial run: it logs what it would have done and changes nothing. |
| Magenta `○ Data Guard off for this session: <why> …` | You switched it off. `/clear` or `/data-guard on` brings it back. |
| Magenta `○ Data Guard off for this project …` | An admin exempted this folder for a while. |
| Red `WARNING: can't reach Data Guard …` | Tailscale is off, or signed in to another tailnet. |

The counts are for the session you're in, and start again in a new one:

- **checks**: prompts, tool calls and tool outputs Data Guard looked at.
- **ms avg**: how long each check takes on average.
- **redacted**: outputs where customer data was swapped for stand-ins such as
  `Person_1a2b` before Claude saw them.
- **blocked**: prompts that weren't sent, tool calls that didn't run, and
  outputs that were held back.

Before the first check of a session the line has no counts:
`● Data Guard on (TrueNorth policy)`. The counts are numbers only: nothing you
type or Claude reads ends up in the status line.

## Installing

The organisation settings should install this plugin for you. If `/plugin`
doesn't list `data-guard` under Installed, install it yourself:

```
/plugin install data-guard --marketplace TrueNorthIT/claude-plugins
```

Admins can also exempt a whole project folder for a set time with the admin
key. The scanner, hooks and settings live in
[TrueNorthIT/claude-code-dlp](https://github.com/TrueNorthIT/claude-code-dlp).
