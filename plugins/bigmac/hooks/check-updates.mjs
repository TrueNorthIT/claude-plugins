#!/usr/bin/env node

/**
 * SessionStart hook — auto-updates the bigmac plugin.
 * Compares the installed version against main; if newer, applies the update
 * (takes effect next session). Silent when current; never blocks the session.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..");

try {
  const local = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const remote = await fetchRemotePluginJson();
  if (remote && isNewer(remote.version, local.version)) {
    try {
      execSync("claude plugin update bigmac@truenorthit", {
        encoding: "utf8",
        timeout: 60000,
        stdio: "pipe",
      });
      console.error(
        `\n  bigmac plugin auto-updated v${local.version} -> v${remote.version} (applies next session).\n`,
      );
    } catch {
      console.error(
        `\n  bigmac plugin v${local.version} is outdated (latest: v${remote.version}).` +
        `\n  Run: /plugin update bigmac@truenorthit\n`,
      );
    }
  }
} catch {
  // Silent — don't block the session if the check fails
}

async function fetchRemotePluginJson() {
  // Anonymous raw fetch (works while the repo is public)
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/TrueNorthIT/claude-plugins/main/plugins/bigmac/.claude-plugin/plugin.json",
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) return await res.json();
  } catch {}
  // Authenticated fallback (keeps working if the repo goes private)
  try {
    const out = execSync(
      "gh api repos/TrueNorthIT/claude-plugins/contents/plugins/bigmac/.claude-plugin/plugin.json --jq .content",
      { encoding: "utf8", timeout: 8000, stdio: "pipe" },
    );
    return JSON.parse(Buffer.from(out, "base64").toString("utf8"));
  } catch {}
  return null;
}

/** Compare semver strings — returns true if a is newer than b. */
function isNewer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}
