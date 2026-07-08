---
name: bigmac
description: Offload grunt work to the local bigmac Ollama server instead of burning frontier tokens — file/batch summaries, first-pass code exploration, bulk classification, rough drafts. Use when the user asks to summarize many files, map/explore/understand a codebase, classify items in bulk, or says "bigmac".
---

# bigmac — delegate grunt work to the office LLM box

bigmac is a Mac Studio (M3 Ultra) running Ollama, reachable on the office LAN or via
Tailscale (see the bigmac repo wiki: How-to-Connect):

- Base URL: `http://bigmac:11434` (OpenAI-compatible at `/v1`, any dummy key).
  LAN fallback: `http://192.168.1.68:11434`. Override via the `BIGMAC_URL` env var.
- Models: `qwen2.5-coder:32b` (fast workhorse — default), `qwen3.6:27b` (dense
  reasoning), `qwen3.6:35b-a3b` (MoE reasoning). The qwen3.6 models "think" first and
  return empty if starved of tokens — give them `num_predict` headroom (e.g.
  `"options": {"num_predict": 4000}`) or prefer the coder model for quick tasks.
- Health check if calls fail: GET `http://bigmac:11434/api/tags`.

**IMPORTANT — auth boundary:** bigmac is reached as a plain HTTP call / subprocess
only. NEVER touch Claude Code's own endpoint or auth (`ANTHROPIC_BASE_URL`,
`ANTHROPIC_API_KEY`, etc.) — the user's subscription login must stay intact.

## Calling bigmac

Windows (PowerShell):

```powershell
$body = @{ model = 'qwen2.5-coder:32b'; prompt = $prompt; stream = $false } | ConvertTo-Json -Depth 4
(Invoke-RestMethod -Uri 'http://bigmac:11434/api/generate' -Method Post `
    -Body $body -ContentType 'application/json' -TimeoutSec 300).response
```

macOS / Linux (bash):

```bash
curl -s http://bigmac:11434/api/generate \
  -d "$(jq -n --arg m qwen2.5-coder:32b --arg p "$PROMPT" '{model:$m, prompt:$p, stream:false}')" \
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

**3. Agentic exploration** — open-ended "map / explore / get familiar with X": check
for Qwen Code (`Get-Command qwen` / `which qwen`). If installed and configured for
bigmac, run it headless and read-only from the target repo's directory:

```
qwen -p "<exploration task>" --approval-mode plan --output-format text --max-tool-calls 60 --max-wall-time 600
```

The qwen model on bigmac then does its own read/grep loop and returns a synthesis.
If Qwen Code is NOT installed, fall back to: locate the relevant files yourself with
Glob/Grep, then run mode 2 over them — and mention to the user that installing Qwen
Code would make this class of task better.

## Division of labour (non-negotiable)

- bigmac output is raw material — verify it before relying on it; redo on Claude if it looks off.
- Keep on Claude: reasoning, planning, architecture, writing/editing code, final synthesis, anything security-sensitive or where a wrong answer is costly.
- Exact/lexical search stays on Grep/Glob/Read — bigmac is for semantic work (summarize/classify/explain), not finding strings.
- Trivial tasks (single small edit, quick question) skip bigmac entirely — direct is faster.
