#!/usr/bin/env node

/**
 * SessionStart hook — checks the installed `dataverse-contact-api` plugin
 * against the latest published version. Runs once per session. Silent if
 * up to date.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, "..");

async function main() {
  let local;
  try {
    local = JSON.parse(
      readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    );
  } catch {
    return;
  }
  const localVersion = local.version;

  let remoteVersion;
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/TrueNorthIT/claude-plugins/main/plugins/dataverse-contact-api/.claude-plugin/plugin.json",
    );
    if (!res.ok) return;
    const remote = await res.json();
    remoteVersion = remote.version;
  } catch {
    return;
  }

  if (!remoteVersion || remoteVersion === localVersion) return;
  if (!isNewer(remoteVersion, localVersion)) return;

  console.error(
    `\n  dataverse-contact-api plugin v${localVersion} is outdated (latest: v${remoteVersion}).` +
      `\n  Run: /plugin marketplace update truenorthit` +
      `\n  Then: /reload-plugins\n`,
  );
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

main().catch(() => {
  // Never block the session on a hook failure.
});
