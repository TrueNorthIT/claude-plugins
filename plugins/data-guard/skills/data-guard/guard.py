#!/usr/bin/env python3
"""Data Guard: check it, or (admins) exempt a project folder.

  guard.py status [--path DIR]
  guard.py project-off --reason "generating synthetic test data" [--until 2026-12-31] [--path DIR] [--user NAME]
  guard.py project-on [--path DIR] [--user NAME]
  guard.py list

Anyone can run status. Switching Data Guard off for one session isn't done
here: the engineer types `/data-guard off <reason>` as a prompt, which only a
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
import sys
import urllib.error
import urllib.request
from pathlib import Path

URL = os.environ.get("SCANNER_URL", "https://claude-dlp.tail08382e.ts.net").rstrip("/")
KEY_FILE = Path.home() / ".claude-dlp" / "admin.key"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
UNREACHABLE = ("Can't reach Data Guard at {url} ({why}). Until it answers, Claude Code won't send "
               "prompts or run tools. Check Tailscale is connected to the TrueNorth tailnet.")


def admin_key() -> str:
    key = os.environ.get("SCANNER_ADMIN_KEY") or (KEY_FILE.read_text().strip() if KEY_FILE.exists() else "")
    if not key:
        sys.exit("Exempting a whole project needs a Data Guard admin, and this machine has no admin key. "
                 "To switch it off for this session only, type /data-guard off <reason> as your own message.")
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


def main() -> None:
    p = argparse.ArgumentParser(description="Check Data Guard, or turn it off or on for a project.")
    p.add_argument("action", choices=["status", "off", "on", "project-off", "project-on", "list"])
    p.add_argument("--path", default=os.getcwd(), help="project folder (default: this one)")
    p.add_argument("--user", default=os.environ.get("USER", "") + os.environ.get("USERNAME", ""))
    p.add_argument("--reason", help="why the project needs it off (required for off)")
    p.add_argument("--until", help="last day it stays off, YYYY-MM-DD (default: 30 days)")
    a = p.parse_args()
    path = os.path.abspath(a.path)

    if a.action in ("off", "on"):
        sys.exit(f"Type /data-guard {a.action} <reason> as your own message. Only a person can switch "
                 "Data Guard off or on for a session, so Claude can't do it for you.")
    if a.action == "status":
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
