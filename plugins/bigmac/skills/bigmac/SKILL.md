---
name: bigmac
description: Offload grunt work to bigmac, TrueNorth's local model endpoint (OpenAI-compatible, over Tailscale), instead of burning frontier tokens — file/batch summaries, first-pass code exploration, bulk classification, rough drafts. Use when the user asks to summarize many files, map/explore/understand a codebase, classify items in bulk, or says "bigmac".
---

# bigmac — delegate grunt work to TrueNorth's local models

bigmac serves TrueNorth's local models through an **OpenAI-compatible Chat Completions
API**, reachable only over the TrueNorth Tailscale network (Infrastructure wiki:
*bigmac / Local Model Endpoint*):

| | |
|---|---|
| Base URL | `https://bigmac-service.tail08382e.ts.net/v1` (override with the `BIGMAC_URL` env var) |
| API | OpenAI **Chat Completions** — `POST /chat/completions`. Not the Responses API, not Ollama (`/api/*` returns 404). |
| API key | Any non-empty value, e.g. `local`. Access is controlled by Tailscale. |

**IMPORTANT — auth boundary:** bigmac is reached as a plain HTTP call only. NEVER touch
Claude Code's own endpoint or auth (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, etc.) —
the user's subscription login must stay intact.

**Client data rules still apply.** Data stays on bigmac, but only send what the user is
allowed to share for that client.

## Preflight — run before the first call

1. `GET {base}/models`. If it times out or fails, say so and do the work on Claude
   instead — don't stall or retry-loop. The usual causes, for the user to fix:
   Tailscale isn't **Connected** (signed in with their `@trueNorthIT.co.uk` account),
   they aren't in `group:bigmac-service-user` (a Tailscale admin adds them), or another
   VPN (e.g. NordLayer) is blocking Tailscale.
2. Pick the model from what `/models` ACTUALLY lists (`data[].id`, exact names). Never
   assume a hardcoded name still exists. Prefer one whose `status.value` is `loaded`; an
   unloaded model takes a minute or two to start on first request.

## Models

Verify against `/models` — the inventory changes:

| Model | Use for |
|---|---|
| `qwen3.8-27b` | **Default.** General chat and coding; summaries, classification, drafts. Usually loaded. |
| `flint` | Quick questions and short analysis. |
| `qwen3.6-35b-a3b` | A larger model to try; often unloaded, so expect a slow first call. |
| `qwen3-embedding-0.6b` | Embeddings only (`/embeddings`) — never for chat. |

**These are thinking models.** They spend tokens reasoning before answering, so a small
`max_tokens` returns empty `content`. For grunt work, switch thinking off with
`"chat_template_kwargs": {"enable_thinking": false}` (fully effective on `qwen3.8-27b`;
`flint` still reasons a little) and give `max_tokens` headroom. Leave thinking on, with
`max_tokens` in the thousands, only where reasoning helps. The reasoning, if any, comes
back in `choices[0].message.reasoning_content`; the answer is in `message.content`.

## Calling bigmac — file-first, never interpolate file content

**NEVER interpolate file content into a double-quoted command string** (e.g.
`"...$(Get-Content -Raw x)..."`) — backticks/`$` in code files get evaluated by the
shell and corrupt or break the call. Build the body in a variable (PowerShell) or a temp
file (bash); content never touches the command line:

```powershell
$base = if ($env:BIGMAC_URL) { $env:BIGMAC_URL } else { 'https://bigmac-service.tail08382e.ts.net/v1' }
$prompt = "Summarise this file:`n" + (Get-Content -Raw $path)   # variable, not inline
$body = @{
    model = 'qwen3.8-27b'
    messages = @(@{ role = 'user'; content = $prompt })
    max_tokens = 2000
    chat_template_kwargs = @{ enable_thinking = $false }
} | ConvertTo-Json -Depth 5
$r = Invoke-RestMethod -Uri "$base/chat/completions" -Method Post -Body $body `
    -ContentType 'application/json' -Headers @{ Authorization = 'Bearer local' } -TimeoutSec 300
$r.choices[0].message.content
```

```bash
BASE="${BIGMAC_URL:-https://bigmac-service.tail08382e.ts.net/v1}"
body="$(mktemp)"
jq -n --rawfile c "$path" '{model:"qwen3.8-27b", max_tokens:2000,
  chat_template_kwargs:{enable_thinking:false},
  messages:[{role:"user", content:("Summarise this file:\n"+$c)}]}' > "$body"
curl -s "$BASE/chat/completions" -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' -d @"$body" | jq -r '.choices[0].message.content'
rm -f "$body"
```

Any OpenAI SDK works the same way: `OpenAI(base_url=<base>, api_key="local")` and
`client.chat.completions.create(...)`, passing `chat_template_kwargs` via `extra_body`.

## Pick a mode

**1. One-shot** — single summary / classification / draft / transform: one call as
above, with the file content attached through the variable or `--rawfile` pattern.

**2. Batch sweep** — many files needing the same treatment: loop mode 1 over the files
**sequentially** (one call per file), collect the outputs, then synthesise the merged
answer yourself on Claude. bigmac is one shared machine that also runs TrueNorth's
automated agents — don't fire parallel requests or very long jobs at it.

**3. Exploration** — open-ended "map / explore / get familiar with X": locate the
relevant files yourself with Glob/Grep (fast, exact), then run mode 2 over them and
synthesise. Claude does the navigation and judgement; bigmac does the per-file reading.

## Status check — when the user asks "is bigmac on the right version?" / "bigmac status"

Report all of:

1. **Plugin**: `claude plugin list` → bigmac's installed version; compare against main
   (`https://raw.githubusercontent.com/TrueNorthIT/claude-plugins/main/plugins/bigmac/.claude-plugin/plugin.json`).
   Remind: a running session uses whatever version was loaded at session start — the
   auto-update hook fetches new versions, but a restart applies them.
2. **Endpoint**: `GET {base}/models` — reachable or not, and each model's id with its
   `status.value` (loaded / unloaded).
3. One line each — plugin current/stale, endpoint reachable, models and which are loaded.

## Report usage at the end

When a task used bigmac, end your final summary with one line of accounting, e.g.:

> bigmac: 7 calls · qwen3.8-27b · ~21k input / 0.8k output tokens handled locally

Every chat completion response carries `usage.prompt_tokens` (input) and
`usage.completion_tokens` (output); total them across calls. This shows what was kept
off the user's Claude budget.

## Division of labour (non-negotiable)

- bigmac output is raw material — verify it before relying on it; redo on Claude if it looks off.
- Keep on Claude: reasoning, planning, architecture, writing/editing code, final synthesis, anything security-sensitive or where a wrong answer is costly.
- Exact/lexical search stays on Grep/Glob/Read — bigmac is for semantic work (summarize/classify/explain), not finding strings.
- Trivial tasks (single small edit, quick question) skip bigmac entirely — direct is faster.
