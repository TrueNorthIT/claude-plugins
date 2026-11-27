---
name: bigmac
description: Offload grunt work to bigmac, TrueNorth's local model endpoint (OpenAI-compatible, on the office network or the WireGuard VPN), instead of burning frontier tokens — file/batch summaries, first-pass code exploration, bulk classification, rough drafts. Use when the user asks to summarize many files, map/explore/understand a codebase, classify items in bulk, or says "bigmac".
---

# bigmac — delegate grunt work to TrueNorth's local models

bigmac serves TrueNorth's local models through an **OpenAI-compatible Chat Completions
API** on the office network (Infrastructure wiki: *bigmac / Local Model Endpoint*).
Connect **ONLY** through this address — in the office directly, remotely over the
TrueNorth WireGuard VPN:

| | |
|---|---|
| Base URL | `https://10.0.70.165:8789/v1` — the only address to use |
| TLS | bigmac's own self-signed certificate. Always call with curl, `-k` **plus** `--pinnedpubkey sha256///5fLdOqebruuMnEbGI2dwmGpPqa5LBpkQ95SFrwdhyo=`: `-k` skips the CA check, the pin proves it's bigmac. Never drop the pin. |
| API | OpenAI **Chat Completions** — `POST /chat/completions`. Not the Responses API, not Ollama (`/api/*` returns 404). |
| API key | Any non-empty value, e.g. `local`. Not checked today; a real key (kept in 1Password) may be required later, so always send one. |

**Tailscale is deprecated.** The old address `https://bigmac-service.tail08382e.ts.net/v1`
still answers for now but is being removed. NEVER use it, not even as a fallback when
the address above can't be reached.

**IMPORTANT — auth boundary:** bigmac is reached as a plain HTTP call only. NEVER touch
Claude Code's own endpoint or auth (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, etc.) —
the user's subscription login must stay intact.

**Client data rules still apply.** Data stays on bigmac, but only send what the user is
allowed to share for that client.

## Preflight — run before the first call

1. `GET {base}/models` (pinned, 10 s timeout):
   `curl -sS --fail -k --pinnedpubkey sha256///5fLdOqebruuMnEbGI2dwmGpPqa5LBpkQ95SFrwdhyo= --connect-timeout 10 --max-time 10 https://10.0.70.165:8789/v1/models`
   (`curl.exe` in PowerShell).
   - **Connection timed out / refused:** the user isn't on the office network. Ask them
     to connect the **WireGuard VPN** (and disconnect any other VPN, e.g. NordLayer, that
     could take the route), then retry **once** when they say it's up. Don't try to
     start the VPN yourself.
   - **Still failing, or the user can't connect:** say so and do the work on Claude —
     don't stall or retry-loop, and don't fall back to Tailscale.
   - **curl exit 90 (pin mismatch):** something other than bigmac answered, or bigmac's
     certificate changed. Stop: send nothing, tell the user, and do the work on Claude.
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
file (bash); content never touches the command line. Both recipes call curl, because
`Invoke-RestMethod` can't pin a key:

```powershell
$base = 'https://10.0.70.165:8789/v1'
$pin  = 'sha256///5fLdOqebruuMnEbGI2dwmGpPqa5LBpkQ95SFrwdhyo='
$prompt = "Summarise this file:`n" + (Get-Content -Raw $path)   # variable, not inline
$body = @{
    model = 'qwen3.8-27b'
    messages = @(@{ role = 'user'; content = $prompt })
    max_tokens = 2000
    chat_template_kwargs = @{ enable_thinking = $false }
} | ConvertTo-Json -Depth 5
$in = New-TemporaryFile; $out = New-TemporaryFile
[IO.File]::WriteAllText($in, $body)   # UTF-8, no BOM
curl.exe -sS --fail -k --pinnedpubkey $pin --connect-timeout 15 --max-time 300 "$base/chat/completions" `
    -H 'Content-Type: application/json' -H 'Authorization: Bearer local' --data-binary "@$in" -o $out
if ($LASTEXITCODE -eq 0) {
    $r = Get-Content -Raw -Encoding utf8 $out | ConvertFrom-Json
    $r.choices[0].message.content
    "usage: $($r.usage.prompt_tokens) in / $($r.usage.completion_tokens) out"   # keep for the usage line
} else { "bigmac call failed or timed out (curl exit $LASTEXITCODE) — do this one on Claude" }
Remove-Item $in, $out
```

```bash
# needs curl and jq (jq isn't bundled with Git for Windows; use the PowerShell recipe there)
BASE="https://10.0.70.165:8789/v1"
PIN="sha256///5fLdOqebruuMnEbGI2dwmGpPqa5LBpkQ95SFrwdhyo="
body="$(mktemp)"
jq -n --rawfile c "$path" '{model:"qwen3.8-27b", max_tokens:2000,
  chat_template_kwargs:{enable_thinking:false},
  messages:[{role:"user", content:("Summarise this file:\n"+$c)}]}' > "$body"
resp="$(mktemp)"
# Timeouts so a dropped VPN or stalled model can't hang a batch.
if curl -sS --fail -k --pinnedpubkey "$PIN" --connect-timeout 15 --max-time 300 "$BASE/chat/completions" \
     -H 'Content-Type: application/json' -H 'Authorization: Bearer local' \
     -d @"$body" -o "$resp"; then
  jq -r '.choices[0].message.content' "$resp"
  jq -r '"usage: \(.usage.prompt_tokens) in / \(.usage.completion_tokens) out"' "$resp" >&2
else
  echo "bigmac call failed or timed out — do this one on Claude" >&2
fi
rm -f "$body" "$resp"
```

Prefer these curl recipes. An OpenAI SDK also works (`OpenAI(base_url=<base>,
api_key="local")`, `chat_template_kwargs` via `extra_body`) but only with bigmac's
certificate file passed in its HTTP client, as the wiki page describes — never with
certificate checking turned off.

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
2. **Endpoint**: `GET {base}/models` on `https://10.0.70.165:8789/v1` (pinned) —
   reachable or not, and each model's id with its `status.value` (loaded / unloaded).
   If unreachable, say whether the user needs the WireGuard VPN. Don't check or report
   the deprecated Tailscale address.
3. One line each — plugin current/stale, endpoint reachable, models and which are loaded.

## Report usage at the end

When a task used bigmac, end your final summary with one line of accounting, e.g.:

> bigmac: 7 calls · qwen3.8-27b · ~21k input / 0.8k output tokens handled locally

Every chat completion response carries `usage.prompt_tokens` (input) and
`usage.completion_tokens` (output) — both recipes above print them after each answer;
record them per call and total them across calls (they can't be recovered later without
repeating the requests). This shows what was kept
off the user's Claude budget.

## Division of labour (non-negotiable)

- bigmac output is raw material — verify it before relying on it; redo on Claude if it looks off.
- Keep on Claude: reasoning, planning, architecture, writing/editing code, final synthesis, anything security-sensitive or where a wrong answer is costly.
- Exact/lexical search stays on Grep/Glob/Read — bigmac is for semantic work (summarize/classify/explain), not finding strings.
- Trivial tasks (single small edit, quick question) skip bigmac entirely — direct is faster.
