---
name: stats
description: How fast Data Guard has been for this user, the last 7 days by default. Times the hook on their own computer, then shows their checks on bigmac by prompt, tool call and tool output, by tool and by day, how long Claude Code waited on it in all, and the slowest checks. Use when the user types /data-guard:stats, or says Claude Code feels slow, Data Guard or the hooks (PostToolUse, "Data Guard is checking the output…") are slowing them down, or asks for their Data Guard numbers.
argument-hint: "[days]"
---

Run the stats, with the number of days the user gave (1 to 30; 7 if they gave none):

```bash
python "<skill dir>/../status/guard.py" stats --days 7
```

`<skill dir>` is this skill's base directory, which Claude Code shows when the skill
loads; `guard.py` sits in the `status` skill beside it. Use `python3` on macOS. It
takes a few seconds: it times five tries of the hook first.

Show what it printed, as it is, in a code block. Then say in two or three lines what
it means for them, from these:

- **"On this computer"** is the cost of every hook before bigmac does anything:
  starting a shell and curl, and the trip over Tailscale. About 300 ms is normal on
  Windows, where starting Git Bash and curl is most of it; a Mac takes under 100 ms.
  Much more points at this computer or its route to bigmac: Tailscale relayed rather
  than direct, a VPN, or antivirus scanning each start.
- **"On bigmac"** is the scanner's own time. Tool output is the slow one because the
  name model reads it; a median under 200 ms and a 90% under 1 s is normal. Long
  outputs (tens of thousands of characters) take longer, and so do many outputs at
  once, such as parallel subagents, which queue for the model.
- **Timed out** means Claude Code waited the whole limit (about 25 s for tool output)
  and went on without an answer.
- If their numbers are far from "Everyone's tool output", say so.

If it says Data Guard didn't answer, ask what the status line says: red means bigmac
can't be reached. The figures are timings, counts and tool names only, never what was
in a prompt or an output.
