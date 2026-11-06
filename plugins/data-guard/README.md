# data-guard

TrueNorth policy sends every prompt and tool call in Claude Code to Data Guard,
a scanner on bigmac. It stops prompts that contain customer data and swaps
customer data in tool output for stand-ins before Claude sees it. It's set for
the whole organisation in the Claude admin console, which also installs this
plugin for everyone.

| You want to | Do this |
|---|---|
| Know what it's doing | Look at the status line, or ask Claude "what's Data Guard doing?" |
| Work with fictional or test data | Type `/data-guard off <why>`. It's off for this session only and logged. `/clear` or `/data-guard on` brings it back. |
| Fix a red status line | Connect Tailscale to the TrueNorth tailnet. Until bigmac answers, prompts and tools are blocked. |

Once the organisation settings are applied there's nothing to install. To try it
before then:

```
/plugin install data-guard --marketplace TrueNorthIT/claude-plugins
```

Admins can also exempt a whole project folder for a set time with the admin
key. The scanner, hooks and settings live in
[TrueNorthIT/claude-code-dlp](https://github.com/TrueNorthIT/claude-code-dlp).
