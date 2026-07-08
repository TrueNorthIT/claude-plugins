---
name: bigmac
description: Offload grunt work to the local bigmac Ollama server instead of burning frontier tokens — file/batch summaries, first-pass code exploration, bulk classification, rough drafts. Use when the user asks to summarize many files, map/explore/understand a codebase, classify items in bulk, or says "bigmac".
---

# bigmac — delegate grunt work to the office LLM box

bigmac is a Mac Studio (M3 Ultra) running Ollama, reachable on the office LAN or via
Tailscale (see the bigmac repo wiki: How-to-Connect):

- Base URL: `http://bigmac:11434` (OpenAI-compatible at `/v1`, any dummy key).
  LAN fallback: `http://192.168.1.68:11434`. Override via the `BIGMAC_URL` env var.
- Health check if calls fail: GET `http://bigmac:11434/api/tags` (also lists current models).

**IMPORTANT — auth boundary:** bigmac is reached as a plain HTTP call only. NEVER touch
Claude Code's own endpoint or auth (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, etc.) —
the user's subscription login must stay intact.

## Preflight — run before the first call

1. `GET /api/tags` on the base URL (LAN fallback if the name doesn't resolve). If
   unreachable, say so (user may be off LAN/Tailscale) and do the work on Claude
   instead — don't stall or retry-loop.
2. Pick the model from what the tags response ACTUALLY lists, in preference order:
   any `qwen3.6:35b-a3b*` → any `qwen3.6:27b*` → `qwen2.5-coder:32b` → the most
   recently modified model. Never assume a hardcoded tag still exists.
3. Send `"think": false` only for models whose tags entry lists the `thinking`
   capability; omit the field otherwise.

## Models

Preference guide (verify against `/api/tags` — the box's inventory changes):

| Model | Use for |
|---|---|
| `qwen3.6:35b-a3b-nvfp4` | **Default.** MoE (3B active) — fast. Always send `"think": false` for grunt work. |
| `qwen3.6:27b-mxfp8` | Dense — harder reasoning. Let it think (`"think": true` + `"options": {"num_predict": 4000}`). |
| `qwen2.5-coder:32b` | Older-gen coder, no thinking support — omit the `think` field entirely. |

qwen3.6 models think by default and will burn seconds (or return empty on small token
budgets) unless `"think": false` is set. Check `/api/tags` if a model is missing.

## Prefer the MCP tools when connected

This plugin bundles the shared `bigmac` MCP server (http://bigmac:8434/mcp). When its
tools are available (named like `mcp__plugin_bigmac_bigmac__ask` or `mcp__bigmac__ask`),
prefer them over raw HTTP: `ask`, `summarize`, `classify`, `models`, `usage` — plus
delegation: `explore_start` / `explore_status` / `explore_result` / `workspaces`.
If the server is unreachable (off LAN/Tailscale), fall back to the raw HTTP recipes
below — don't stall.

**Delegated exploration** (open-ended "map / explore this repo" on a synced copy,
zero frontier tokens while it runs):

1. Sync first — ask the user to run `scripts/bigmac-sync.ps1` (or `.sh`) from the
   repo, or run it yourself if permitted; syncing ships source to the shared box, so
   it is user-triggered by design.
2. `explore_start(workspace, question)` → poll `explore_status` every ~30s (jobs are
   minutes-long; one runs at a time) → `explore_result`.
3. **Verify before relaying**: spot-check 2–3 of the result's file:line citations
   against the real repo with Read/Grep. Delegation output is a draft map, never a
   source of truth.

End any task that used these tools with the usage line (the `usage` tool has totals).

## Calling bigmac — file-first, never interpolate file content

**NEVER interpolate file content into a double-quoted command string** (e.g.
`"...$(Get-Content -Raw x)..."`) — backticks/`$` in code files get evaluated by the
shell and corrupt or break the call. Pass file content via `-File` or a variable.

Preferred — the `bigmac-ask` wrapper v2 (see the bigmac wiki, Set-up-Claude-Code):

```powershell
bigmac-ask "Summarise each of these files" -File src\a.ps1, src\b.ps1
bigmac-ask "<prompt>" [model] [-System "..."] [-Think] [-Stats]
```

Raw HTTP without the wrapper — build the body in a variable (PowerShell) or send it
from a temp file (bash); content never touches the command line:

```powershell
$prompt = "Summarise this file:`n" + (Get-Content -Raw $path)   # variable, not inline
$body = @{ model = 'qwen3.6:35b-a3b-nvfp4'; prompt = $prompt; think = $false; stream = $false } | ConvertTo-Json -Depth 4
(Invoke-RestMethod -Uri 'http://bigmac:11434/api/generate' -Method Post `
    -Body $body -ContentType 'application/json' -TimeoutSec 300).response
```

```bash
jq -n --rawfile c "$path" '{model:"qwen3.6:35b-a3b-nvfp4", prompt:("Summarise this file:\n"+$c), think:false, stream:false}' > /tmp/body.json
curl -s http://bigmac:11434/api/generate -d @/tmp/body.json | jq -r .response
```

## Pick a mode

**1. One-shot** — single summary / classification / draft / transform: one call as
above, attaching file content with `-File` (or the variable/`--rawfile` patterns).

**2. Batch sweep** — many files needing the same treatment: loop mode 1 over the files
sequentially (one call per file — Ollama serializes concurrent requests on one GPU
anyway), collect the outputs, then synthesize the merged answer yourself on Claude.

**3. Exploration** — open-ended "map / explore / get familiar with X": locate the
relevant files yourself with Glob/Grep (fast, exact), then run mode 2 over them and
synthesize. Claude does the navigation and judgment; bigmac does the per-file reading.

## Status check — when the user asks "is bigmac on the right version?" / "bigmac status"

Report all of:

1. **Plugin**: `claude plugin list` → bigmac's installed version; compare against main
   (`https://raw.githubusercontent.com/TrueNorthIT/claude-plugins/main/plugins/bigmac/.claude-plugin/plugin.json`).
   Remind: a running session uses whatever version was loaded at session start — the
   auto-update hook fetches new versions, but a restart applies them.
2. **Server**: `GET /api/version` (Ollama version) and `GET /api/tags` (installed
   models); `GET /api/ps` shows what's loaded in memory right now.
3. One line each — plugin current/stale, server reachable + version, models present.

## Report usage at the end

When a task used bigmac, end your final summary with one line of accounting, e.g.:

> bigmac: 7 calls · qwen3.6:35b-a3b-nvfp4 · ~21k input / 0.8k output tokens handled locally

Every `/api/generate` response includes the numbers — `prompt_eval_count` (input) and
`eval_count` (output); total them across calls. This shows what was kept off the
user's Claude budget. Prefer raw API calls over the wrapper when you need the counts.

## Division of labour (non-negotiable)

- bigmac output is raw material — verify it before relying on it; redo on Claude if it looks off.
- Keep on Claude: reasoning, planning, architecture, writing/editing code, final synthesis, anything security-sensitive or where a wrong answer is costly.
- Exact/lexical search stays on Grep/Glob/Read — bigmac is for semantic work (summarize/classify/explain), not finding strings.
- Trivial tasks (single small edit, quick question) skip bigmac entirely — direct is faster.
