#!/usr/bin/env python3
"""Data Guard: check it, or (admins) exempt a project folder.

  guard.py status [--path DIR]
  guard.py stats [--days 7]
  guard.py fill reply.draft.md --from contacts.csv [--from more.json] [--out reply.md]
  guard.py project-off --reason "generating synthetic test data" [--until 2026-12-31] [--path DIR] [--user NAME]
  guard.py project-on [--path DIR] [--user NAME]
  guard.py list

fill puts the real values back into a draft Claude wrote with stand-ins (Person_1a2b
and so on), from source files on this machine, and writes the result next to it
(reply.draft.md becomes reply.md). Data Guard finds the values in the sources and
swaps back only the stand-ins they match; it stores nothing. It goes the way the
organisation's hooks go (Tailscale, then bigmac's own network, pinned to its key),
using Claude Code's copy of the managed settings, and prints stand-ins and counts
only, never a value. The filled file holds real customer data: send or use it
yourself.

stats says how fast Data Guard has been for you: it times the hook on this computer
(five tries through the organisation's hook command), then asks the scanner for your
checks in the audit log. Timings, counts and tool names only.

Anyone can run status, stats and fill. Switching Data Guard off for one session isn't done
here: the engineer types `/data-guard:off <reason>` as a prompt, which only a
person can do. project-off, project-on and list need the Data Guard admin key
in ~/.claude-dlp/admin.key, or SCANNER_ADMIN_KEY; the key is never printed.

The folder defaults to the current one and the user to the one Claude Code's
hooks send (USER and USERNAME joined, as in the org settings). project-off
lasts 30 days unless --until says otherwise. SCANNER_URL overrides the
scanner address.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Tuple

URL = os.environ.get("SCANNER_URL", "https://claude-dlp.tail08382e.ts.net").rstrip("/")
KEY_FILE = Path.home() / ".claude-dlp" / "admin.key"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
UNREACHABLE = ("Can't reach Data Guard at {url} ({why}). Until it answers, Claude Code won't send "
               "prompts or run tools. Check Tailscale is connected to the TrueNorth tailnet.")


def admin_key() -> str:
    key = os.environ.get("SCANNER_ADMIN_KEY") or (KEY_FILE.read_text().strip() if KEY_FILE.exists() else "")
    if not key:
        sys.exit("Exempting a whole project needs a Data Guard admin, and this machine has no admin key. "
                 "To switch it off for this session only, type /data-guard:off <reason> as your own message.")
    return key


def request(method: str, path: str, body=None, headers=None) -> bytes:
    req = urllib.request.Request(f"{URL}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        reason = {401: "the admin key was refused", 404: "the scanner has no admin key set up"}.get(e.code)
        detail = reason or json.loads(e.read() or b"{}").get("error", e.reason)
        sys.exit(f"Data Guard said no ({e.code}): {detail}")
    except urllib.error.URLError as e:
        sys.exit(UNREACHABLE.format(url=URL, why=e.reason))


def admin(method: str, body=None):
    return json.loads(request(method, "/exemptions", body, {"x-admin-key": admin_key()}) or b"null")


def settings_file() -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "remote-settings.json"


def hook_command(settings: Path) -> str:
    """The organisation's PostToolUse hook command, from Claude Code's copy of the managed settings."""
    try:
        groups = json.loads(settings.read_text(encoding="utf-8"))["hooks"]["PostToolUse"]
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit(f"Can't read the organisation's settings in {settings}. Start Claude Code once, signed in "
                 "to the TrueNorth organisation, then try again.")
    for g in groups:
        for h in g.get("hooks", []):
            if "/hook" in h.get("command", ""):
                return h["command"]
    sys.exit("The organisation's settings have no Data Guard hook, so there's nothing to fill with.")


def via_hook(path: str, body: dict, what: str) -> Tuple[bytes, float]:
    """POST body to path the way the organisation's hooks go: their own hook command, with
    /hook swapped for path, so it takes the same route with the same key. With SCANNER_KEY set
    (testing), straight to SCANNER_URL instead. (What came back, seconds it took.)"""
    started = time.perf_counter()
    if os.environ.get("SCANNER_KEY"):
        raw = request("POST", path, body, {"x-scanner-key": os.environ["SCANNER_KEY"],
                                           "x-user": os.environ.get("USER", "") + os.environ.get("USERNAME", "")})
    else:
        bash = shutil.which("bash")
        if not bash:
            sys.exit(f"{what} needs bash (Git Bash on Windows), as Claude Code's hooks do.")
        command = hook_command(settings_file()).replace("/hook", path)
        r = subprocess.run([bash, "-c", command], input=json.dumps(body).encode("utf-8"),
                           capture_output=True, timeout=120)
        raw = r.stdout
    return raw, time.perf_counter() - started


def post_fill(body: dict) -> dict:
    raw, _ = via_hook("/fill", body, "fill")
    try:
        return json.loads(raw)
    except ValueError:
        sys.exit("Data Guard didn't answer, so nothing was filled. Check the status line isn't red, "
                 "then try again.")


# ------------------------------------------------------------------ stats
TRIES = 5
EVENT_NAMES = {"UserPromptSubmit": "Your prompts", "PreToolUse": "Tool calls, before",
               "PostToolUse": "Tool output, after"}


def took(ms) -> str:
    ms = ms or 0
    if ms < 1000:
        return f"{ms:.0f} ms"
    return f"{ms / 1000:.1f} s" if ms < 60_000 else f"{ms / 60_000:.1f} min"


def span(seconds: float) -> str:
    s = int(round(seconds))
    if s < 60:
        return f"{s} s"
    return f"{s // 60} min {s % 60:02d} s" if s < 3600 else f"{s // 3600} h {s % 3600 // 60:02d} min"


def when(iso: str) -> str:
    """Sun 9 Nov 12:18, in this computer's time."""
    t = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    return f"{t:%a} {t.day} {t:%b %H:%M}"


def tool_name(tool) -> str:
    """mcp__claude-in-chrome__navigate -> claude-in-chrome navigate."""
    tool = str(tool or "a tool")
    return " ".join(tool.split("__")[1:]) if tool.startswith("mcp__") else tool


def stats_text(rep: dict, hook_ms: float, direct: bool) -> str:
    row = "  {:<24}{:>8}{:>10}{:>10}{:>10}{:>10}{:>11}"
    head = row.format("", "checks", "median", "90%", "slowest", "over 1 s", "timed out")
    lines = [f"Data Guard speed for {rep['user']}, last {rep['days']} day{'s' if rep['days'] != 1 else ''}", "",
             "On this computer"]
    how = "straight to the scanner (SCANNER_KEY is set)" if direct else "through the organisation's hook command"
    lines.append(f"  Each hook takes {took(hook_ms)} to start, reach bigmac and come back "
                 f"(the middle of {TRIES} tries, {how}).")
    lines.append(f"  Bash, Read, MCP and other calls checked before and after wait about {took(2 * hook_ms)} "
                 "for that alone.")
    lines += ["", "On bigmac, its own time per check", head]
    for event, name in EVENT_NAMES.items():
        e = rep["events"][event]
        lines.append(row.format(name, f"{e['checks']:,}", took(e["median_ms"]), took(e["p90_ms"]),
                                took(e["slowest_ms"]), f"{e['over_1s']:,}", f"{e['timed_out']:,}"))
    every = rep["everyone"]["PostToolUse"]
    lines.append(row.format("Everyone's tool output", f"{every['checks']:,}", took(every["median_ms"]),
                            took(every["p90_ms"]), "", "", ""))
    if rep["tools"]:
        wide = "  {:<40}{:>8}{:>10}{:>10}{:>10}{:>10}{:>13}"  # MCP tools have long names
        lines += ["", "Tool output by tool, most time first",
                  wide.format("", "checks", "median", "90%", "slowest", "over 1 s", "in all")]
        for t in rep["tools"]:
            lines.append(wide.format(tool_name(t["tool"])[:39], f"{t['checks']:,}", took(t["median_ms"]),
                                     took(t["p90_ms"]), took(t["slowest_ms"]), f"{t['over_1s']:,}",
                                     span(t["total_s"])))
    if rep["by_day"]:
        lines += ["", "Tool output by day", row.format("", "checks", "median", "90%", "slowest", "over 1 s", "")]
        for d in rep["by_day"]:
            t = datetime.date.fromisoformat(d["day"])
            day = f"{t:%a} {t.day} {t:%b}"
            lines.append(row.format(day, f"{d['checks']:,}", took(d["median_ms"]), took(d["p90_ms"]),
                                    took(d["slowest_ms"]), f"{d['over_1s']:,}", "").rstrip())
    w = rep["waited"]
    lines += ["", "In all"]
    if w["active_minutes"]:
        lines.append(f"  Claude Code waited about {span(w['seconds'])} on Data Guard over "
                     f"{span(w['active_minutes'] * 60)} of use: {span(w['per_hour_seconds'])} an hour, "
                     f"and {w['long_waits']:,} waits of 5 s or more.")
        lines.append(f"  That counts {took(rep['overhead_ms'])} on this computer for every check, and "
                     "waits at the same time once.")
    else:
        lines.append("  No checks in that time.")
    if rep["slowest"]:
        lines += ["", "Slowest checks"]
        for s in rep["slowest"]:
            where = {"UserPromptSubmit": "prompt", "PreToolUse": f"{tool_name(s['tool'])} call"}.get(
                s["event"], f"{tool_name(s['tool'])} output")
            notes = []
            if str(s.get("action") or "").endswith("timeout"):
                notes.append("timed out")
            if s.get("chars"):
                notes.append(f"{s['chars']:,} characters")
            if s.get("model_chunks"):
                notes.append(f"{s['model_chunks']} chunk{'s' if s['model_chunks'] != 1 else ''} for the name model")
            lines.append(f"  {when(s['ts']):<17}{where[:30]:<31}{took(s['ms']):>9}"
                         + (f"  ({', '.join(notes)})" if notes else ""))
    return "\n".join(lines)


def stats(days: int) -> None:
    direct = bool(os.environ.get("SCANNER_KEY"))
    times = []
    for _ in range(TRIES):
        raw, seconds = via_hook("/stats", {"ping": True}, "stats")
        try:
            if json.loads(raw).get("ok") is not True:
                raise ValueError
        except (ValueError, AttributeError):
            sys.exit("Data Guard didn't answer. Check the status line isn't red, then try again. If it's "
                     "green, the scanner may not have /stats yet.")
        times.append(seconds * 1000)
    hook_ms = sorted(times)[len(times) // 2]
    raw, _ = via_hook("/stats", {"days": days, "overhead_ms": round(hook_ms)}, "stats")
    try:
        rep = json.loads(raw)
    except ValueError:
        sys.exit("Data Guard answered the timing tries but not the stats. Try again in a minute.")
    if "error" in rep or "events" not in rep:
        sys.exit(f"Data Guard couldn't give the stats: {rep.get('error', 'no reason given')}")
    print(stats_text(rep, hook_ms, direct))


def filled_name(draft: Path) -> Path:
    """reply.draft.md -> reply.md; anything not named as a draft gets .filled before its extension."""
    name = re.sub(r"\.draft(?=\.[^.]+$|$)", "", draft.name, flags=re.IGNORECASE)
    if name == draft.name:
        name = f"{draft.stem}.filled{draft.suffix}"
    return draft.with_name(name)


def fill(draft_path: str, sources: list, out: str) -> None:
    draft = Path(draft_path or "")
    if not draft_path or not draft.is_file():
        sys.exit("Say which draft to fill, e.g. guard.py fill reply.draft.md --from contacts.csv")
    if not sources:
        sys.exit("Say where the real values are with --from <file> (repeat it for several files).")
    target = Path(out) if out else filled_name(draft)
    for p in [draft, *map(Path, sources)]:
        if not p.is_file():
            sys.exit(f"{p} isn't a file.")
        if target.resolve() == p.resolve():
            sys.exit(f"Filling would overwrite {p}. Choose another --out.")
    body = {"text": draft.read_text(encoding="utf-8"),
            "sources": [Path(s).read_text(encoding="utf-8", errors="replace") for s in sources]}
    answer = post_fill(body)
    if "text" not in answer:
        sys.exit(f"Data Guard couldn't fill it: {answer.get('error', 'no reason given')}")
    target.write_text(answer["text"], encoding="utf-8", newline="")
    print(f"Filled {answer.get('filled', 0)} stand-in(s) into {target}. It holds real customer data: "
          "send or use it yourself, and don't paste it back to Claude.")
    if answer.get("unfilled"):
        print("Not in the sources, left as they are: " + ", ".join(answer["unfilled"]))
    if answer.get("ambiguous"):
        print("Two different values share these stand-ins, so they're left for you to fill by hand: "
              + ", ".join(answer["ambiguous"]))


def main() -> None:
    p = argparse.ArgumentParser(description="Check Data Guard, fill a draft, or turn it off or on for a project.")
    p.add_argument("action", choices=["status", "stats", "fill", "off", "on", "project-off", "project-on", "list"])
    p.add_argument("--days", type=int, default=7, help="stats: how many days back to look, 1 to 30 (default 7)")
    p.add_argument("draft", nargs="?", help="fill: the draft with stand-ins, e.g. reply.draft.md")
    p.add_argument("--from", dest="sources", action="append", default=[],
                   help="fill: a file holding the real values (repeat for several)")
    p.add_argument("--out", help="fill: where to write the filled copy (default: the draft's name without .draft)")
    p.add_argument("--path", default=os.getcwd(), help="project folder (default: this one)")
    p.add_argument("--user", default=os.environ.get("USER", "") + os.environ.get("USERNAME", ""))
    p.add_argument("--reason", help="why the project needs it off (required for off)")
    p.add_argument("--until", help="last day it stays off, YYYY-MM-DD (default: 30 days)")
    a = p.parse_args()
    path = os.path.abspath(a.path)

    if a.action in ("off", "on"):
        sys.exit(f"Type /data-guard:{a.action}{' <reason>' if a.action == 'off' else ''} as your own message. Only a person can switch "
                 "Data Guard off or on for a session, so Claude can't do it for you.")
    if a.action == "fill":
        fill(a.draft, a.sources, a.out)
    elif a.action == "stats":
        if not 1 <= a.days <= 30:
            sys.exit("--days must be 1 to 30.")
        stats(a.days)
    elif a.action == "status":
        session = os.environ.get("CLAUDE_CODE_SESSION_ID")
        line = request("POST", "/statusline", {"cwd": path, "session_id": session}, {"x-user": a.user})
        print(ANSI.sub("", line.decode("utf-8")).strip().lstrip("●○ ") + f"  [{path}, user {a.user}]")
    elif a.action == "list":
        rows = admin("GET")
        if not rows:
            print("No projects are exempt: Data Guard checks everything.")
        for r in rows:
            print(f"{r['user']}  {r['path']}  until {r.get('until', 'no end date')}  ({r.get('reason', '')})")
    elif a.action == "project-off":
        if not a.reason:
            sys.exit("Give a reason with --reason, e.g. --reason \"generating synthetic test data\".")
        until = a.until or (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
        r = admin("POST", {"user": a.user, "path": path, "reason": a.reason, "until": until})
        print(f"Data Guard is off for {r['path']} for {r['user']} until {r['until']} ({r['reason']}).")
        print("Nothing from this folder is checked or redacted, in any session. "
              "The status line turns magenta within 15 seconds.")
    else:
        r = admin("DELETE", {"user": a.user, "path": path})
        if r.get("removed"):
            print(f"Data Guard is back on for {path} for {a.user}. The status line goes green within 15 seconds.")
        else:
            print(f"{path} wasn't exempt for {a.user}, so nothing changed. Run `list` to see what is.")


if __name__ == "__main__":
    main()
