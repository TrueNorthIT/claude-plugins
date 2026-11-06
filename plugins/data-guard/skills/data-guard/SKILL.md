---
name: data-guard
description: TrueNorth's Data Guard, which checks Claude Code prompts and tool output for customer data under organisation policy. Use when the user types /data-guard off or on, asks whether Data Guard (or DLP, or the customer-data scanner) is on, why a prompt or tool call was blocked or output redacted, what the status line means, how to switch it off while testing with fictional or test data, or what is exempt.
---

# Data Guard

TrueNorth policy sends every prompt and tool call in Claude Code to Data Guard,
a scanner on bigmac. It stops prompts that contain customer data and swaps
customer data in tool output for stand-ins such as `Person_1a2b`, `Client_1a2b`,
`contact-1a2b3c@redacted.invalid`, `07700 900123` or `QQ123456C`. It's set for
the whole organisation, so nobody can remove it in their own settings.

## Switching it off for this session

The user types it themselves, as their own message:

```
/data-guard off testing against the test tenant with fictional data
/data-guard on
```

Data Guard sees that message before you do and switches off **this session
only**, logging who did it and why. `/clear` starts a new session, which brings
it back on, as does `/data-guard on`. You can't do this for the user: only a
message they send switches it. So:

- **They typed `/data-guard off …`:** it's already off. Run `status` (below) to
  confirm, then tell them it's off for this session, why it was logged, and that
  `/clear` or `/data-guard on` turns it back on. Remind them it's for fictional
  or test data only.
- **They typed `/data-guard on`:** it's back on. Run `status` to confirm.
- **They asked you in other words to turn it off:** tell them to send
  `/data-guard off <why>` themselves. Don't run anything that tries to switch it.

## Checking it

```bash
python "<skill dir>/guard.py" status --path "<project folder>"
```

`<skill dir>` is this skill's base directory, which Claude Code shows when the
skill loads; `guard.py` sits next to this file. Use `python3` on macOS.

| Status line | Meaning |
|---|---|
| Green `● Data Guard on (TrueNorth policy)` | Checking and redacting. |
| Yellow `● Data Guard watching …` | Audit mode: it logs, changes nothing. |
| Magenta `○ Data Guard off for this session …` | The user switched it off. `/clear` brings it back. |
| Magenta `○ Data Guard off for this project …` | An admin exempted this folder for a while. |
| Red `WARNING: can't reach Data Guard …` | Prompts and tools are blocked. Usually Tailscale is off or on another tailnet. |

## Blocked or redacted

Explain what Data Guard did, from the message it gave. Don't try to get round
it, for example by encoding, splitting or re-reading the data another way. If
the data is fictional or test data, the user can switch off for the session.

## Admins: exempting a whole project

For a project that always uses fictional data, an admin with the key in
`~/.claude-dlp/admin.key` can exempt the folder for a set time:

```bash
python "<skill dir>/guard.py" project-off --path "<folder>" --reason "<why>" [--until YYYY-MM-DD] [--user <name>]
python "<skill dir>/guard.py" project-on --path "<folder>" [--user <name>]
python "<skill dir>/guard.py" list
```

`~/.claude-dlp/admin.key` holds a secret. Never read or print it.
