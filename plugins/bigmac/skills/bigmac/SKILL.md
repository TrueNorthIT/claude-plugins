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

## Models

| Model | Use for |
|---|---|
| `qwen3.6:35b-a3b-nvfp4` | **Default.** MoE (3B active) — fast. Always send `"think": false` for grunt work. |
| `qwen3.6:27b-mxfp8` | Dense — harder reasoning. Let it think (`"think": true` + `"options": {"num_predict": 4000}`). |
| `qwen2.5-coder:32b` | Older-gen coder, no thinking support — omit the `think` field entirely. |

qwen3.6 models think by default and will burn seconds (or return empty on small token
budgets) unless `"think": false` is set. Check `/api/tags` if a model is missing.

## Calling bigmac

Windows (PowerShell):

```powershell
$body = @{ model = 'qwen3.6:35b-a3b-nvfp4'; prompt = $prompt; think = $false; stream = $false } | ConvertTo-Json -Depth 4
(Invoke-RestMethod -Uri 'http://bigmac:11434/api/generate' -Method Post `
    -Body $body -ContentType 'application/json' -TimeoutSec 300).response
```

macOS / Linux (bash):

```bash
curl -s http://bigmac:11434/api/generate \
  -d "$(jq -n --arg p "$PROMPT" '{model:"qwen3.6:35b-a3b-nvfp4", prompt:$p, think:false, stream:false}')" \
  | jq -r .response
```

If the user has the `bigmac-ask` wrapper installed (see the bigmac wiki,
Set-up-Claude-Code), prefer it: `bigmac-ask "<prompt>" [model]`.

## Pick a mode

**1. One-shot** — single summary / classification / draft / transform: one call as
above, embedding file content in the prompt (`Get-Content -Raw` / `cat`).

**2. Batch sweep** — many files needing the same treatment: loop mode 1 over the files
sequentially (one call per file — Ollama serializes concurrent requests on one GPU
anyway), collect the outputs, then synthesize the merged answer yourself on Claude.

**3. Exploration** — open-ended "map / explore / get familiar with X": locate the
relevant files yourself with Glob/Grep (fast, exact), then run mode 2 over them and
synthesize. Claude does the navigation and judgment; bigmac does the per-file reading.

## Division of labour (non-negotiable)

- bigmac output is raw material — verify it before relying on it; redo on Claude if it looks off.
- Keep on Claude: reasoning, planning, architecture, writing/editing code, final synthesis, anything security-sensitive or where a wrong answer is costly.
- Exact/lexical search stays on Grep/Glob/Read — bigmac is for semantic work (summarize/classify/explain), not finding strings.
- Trivial tasks (single small edit, quick question) skip bigmac entirely — direct is faster.
