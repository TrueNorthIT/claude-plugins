#!/usr/bin/env node

/**
 * SessionStart hook — checks for plugin and CLI updates.
 * Runs once per session. Silent if everything is up to date.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..");

// ── Check plugin version against marketplace ────────────────────────────
try {
  const local = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const localVersion = local.version;

  // Fetch latest from GitHub (raw plugin.json from main branch)
  const res = await fetch(
    "https://raw.githubusercontent.com/TrueNorthIT/claude-plugins/main/plugins/dataverse-portal/.claude-plugin/plugin.json",
  );
  if (res.ok) {
    const remote = await res.json();
    if (remote.version !== localVersion && isNewer(remote.version, localVersion)) {
      console.error(
        `\n  dataverse-portal plugin v${localVersion} is outdated (latest: v${remote.version}).` +
        `\n  Run: /plugin marketplace update truenorthit` +
        `\n  Then: /reload-plugins\n`,
      );
    }
  }
} catch {
  // Silent — don't block the session if the check fails
}

// ── Check CLI version ───────────────────────────────────────────────────
try {
  let installed = "";
  try {
    installed = execSync("npm list -g @truenorth-it/contact-admin --depth=0 --json 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000,
    });
    const parsed = JSON.parse(installed);
    const deps = parsed.dependencies?.["@truenorth-it/contact-admin"];
    installed = deps?.version ?? "";
  } catch {
    installed = "";
  }

  if (!installed) {
    console.error(
      `\n  @truenorth-it/contact-admin CLI is not installed.` +
      `\n  Run: npm install -g @truenorth-it/contact-admin\n`,
    );
  } else {
    // Check for newer version on npm
    try {
      const latest = execSync("npm view @truenorth-it/contact-admin version 2>/dev/null", {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      if (latest && latest !== installed && isNewer(latest, installed)) {
        console.error(
          `\n  @truenorth-it/contact-admin v${installed} is outdated (latest: v${latest}).` +
          `\n  Run: npm install -g @truenorth-it/contact-admin@latest\n`,
        );
      }
    } catch {
      // Silent
    }
  }
} catch {
  // Silent
}

/** Compare semver strings — returns true if a is newer than b. */
function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}
