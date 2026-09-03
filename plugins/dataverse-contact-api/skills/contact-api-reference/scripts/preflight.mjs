#!/usr/bin/env node

/**
 * preflight.mjs — check the prerequisites for a Dataverse Contact API help desk
 * pack, then write the two .env files.
 *
 * Five values stand between a cloned pack and a working portal. Three of them
 * cannot be guessed (the API URL, the admin connection key, the SPA client id)
 * and two are published by the API itself (the Entra tenant id and the API
 * scope). This script asks for the first three, discovers the last two from the
 * API's public metadata document, verifies everything against the live
 * deployment, and writes:
 *
 *   <out>/terraform/.env   the Terraform runner's credentials
 *   <out>/app/.env         the Vite build's public configuration
 *
 * Read-only against the API. Nothing is published, changed or deleted.
 *
 * Usage:
 *   node preflight.mjs [--url <api>] [--key <key>] [--scope <name>]
 *                      [--spa-client-id <guid>] [--out <dir>]
 *                      [--check] [--force] [--yes]
 *
 * --check runs every check and writes nothing — the "am I ready?" mode.
 * --force is required to overwrite a .env that already exists.
 * --yes never prompts: a missing required value is a clear failure instead.
 *
 * The connection key is read from DATAVERSE_CONTACT_CONNECTION_KEY when set, so
 * it need not be typed. It is never printed — masked as `abcd…wxyz` at most.
 *
 * Exits non-zero if any check fails.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as readline from "node:readline/promises";

const DEFAULT_URL = "https://api.dataverse-contact.tnapps.co.uk";
const DEFAULT_SCOPE = "helpdesk";

// A hanging preflight is worse than a failing one: every request is bounded.
const TIMEOUT_MS = 15000;

// The route the help desk pack's Terraform publishes. Its presence in the
// scope's schema is what proves `terraform apply` has run against this scope.
const EXPECTED_ROUTE = "case";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── args ────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[k] = next;
      i++;
    } else {
      out[k] = true;
    }
  }
  return out;
}

function str(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function die(msg) {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(
    [
      "preflight.mjs — prerequisite check + .env writer for the Contact API help desk packs",
      "",
      "  node preflight.mjs [--url <api>] [--key <key>] [--scope <name>]",
      "                     [--spa-client-id <guid>] [--out <dir>]",
      "                     [--check] [--force] [--yes]",
      "",
      "  --url             Contact API base URL (origin only). Prompted if omitted.",
      "  --key             Admin connection key. Defaults to $DATAVERSE_CONTACT_CONNECTION_KEY.",
      "  --scope           API scope. Default: helpdesk.",
      "  --spa-client-id   Entra application (client) id of your SPA registration.",
      "  --out             Pack directory holding terraform/ and app/. Default: .",
      "  --check           Run every check, write nothing.",
      "  --force           Overwrite an existing .env.",
      "  --yes             Never prompt; fail if a required value is missing.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const checkOnly = args.check === true;
const force = args.force === true;
const assumeYes = args.yes === true || args.y === true;

// No TTY means no prompting is possible, whatever the flags say.
const interactive = !assumeYes && process.stdin.isTTY === true;

const outDir = resolve(str(args.out) ?? ".");

/* ── output ──────────────────────────────────────────────────────────── */

let failures = 0;
let skipped = 0;

const ok = (msg) => console.log(`OK   ${msg}`);
const info = (msg) => console.log(`     ${msg}`);
const warn = (msg) => console.log(`WARN ${msg}`);
const skip = (msg) => {
  skipped++;
  console.log(`SKIP ${msg}`);
};
const fail = (msg) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

function heading(msg) {
  console.log(`\n${msg}`);
  console.log("─".repeat(Math.min(78, Math.max(20, msg.length))));
}

// The key is a deployment-wide secret. It never reaches stdout or stderr in
// full — not in a success line, not in an error, not in a stack trace.
function maskKey(key) {
  if (!key) return "(none)";
  const s = String(key);
  if (s.length < 12) return "(hidden — too short to mask safely)";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/* ── value normalisation ─────────────────────────────────────────────── */

// The API URL must be the ORIGIN only. The SDK and the Terraform provider both
// build their paths as `${base}/api/v2/${scope}/...`, so a base that already
// carries "/api/v2" produces "/api/v2/api/v2/..." and every call 404s.
function normaliseApiUrl(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!u.hostname) return null;
  const droppedPath = u.pathname && u.pathname !== "/" ? u.pathname : "";
  const droppedQuery = (u.search || "") + (u.hash || "");
  return { url: u.origin, dropped: `${droppedPath}${droppedQuery}` };
}

function isGuid(v) {
  return typeof v === "string" && GUID_RE.test(v.trim());
}

// The Entra External ID issuer is
//   https://<tenantId>.ciamlogin.com/<tenantId>/v2.0
// so the GUID appears twice — once as the subdomain, once as the first path
// segment. Workforce Entra puts it only in the path. Rather than regex-replace
// (which passes a non-matching input through UNCHANGED and silently yields a
// malformed tenant id), collect the candidates and return the first that is
// genuinely a GUID. Null means "could not determine", which is a hard failure.
function extractTenantId(issuer) {
  let u;
  try {
    u = new URL(String(issuer));
  } catch {
    return null;
  }
  const candidates = [u.hostname.split(".")[0], ...u.pathname.split("/").filter(Boolean)];
  for (const c of candidates) {
    if (isGuid(c)) return c.toLowerCase();
  }
  return null;
}

// idp_audience may arrive as a bare GUID *or* as an already-prefixed
// "api://<guid>" — the API does not normalise it. Blindly appending produces
// "api://api://<guid>/access_as_user", MSAL requests a scope that does not
// exist, and nobody can sign in. That bug shipped once; hence the loop.
function apiScopeFromAudience(audience) {
  let a = String(audience ?? "").trim();
  while (/^api:\/\//i.test(a)) a = a.slice("api://".length);
  a = a.replace(/\/+$/, "");
  a = a.replace(/\/access_as_user$/i, "");
  a = a.replace(/\/+$/, "");
  if (!a) return null;
  return `api://${a}/access_as_user`;
}

/* ── http ────────────────────────────────────────────────────────────── */

async function getJson(url, { key } = {}) {
  const headers = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const reason =
      err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `no response within ${TIMEOUT_MS / 1000}s`
        : err?.message || String(err);
    return { networkError: reason };
  }
  const text = await res.text().catch(() => "");
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON — the caller decides whether that matters */
  }
  return { status: res.status, ok: res.ok, json, text };
}

/* ── prompts ─────────────────────────────────────────────────────────── */

let rl = null;

function getRl() {
  if (rl) return rl;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return rl;
}

function closeRl() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

// stdin can close under us — Ctrl-D, or a redirect that runs out of input.
// readline then throws ERR_USE_AFTER_CLOSE, which is a stack trace where a
// sentence belongs.
async function question(prompt) {
  try {
    return await getRl().question(prompt);
  } catch (err) {
    if (err?.code === "ERR_USE_AFTER_CLOSE") {
      die("Input ended before the question was answered. Pass the values as flags instead.");
    }
    throw err;
  }
}

async function ask(q, fallback) {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await question(`${q}${suffix}: `)).trim();
  return answer || fallback || "";
}

// Read a line from a raw-mode TTY without echoing it. readline cannot do this
// on Node 20+ (the _writeToOutput hook older recipes patch is gone), so the
// characters are collected by hand. Backspace works; Ctrl-C still quits.
function readSecretRaw(promptText) {
  return new Promise((resolvePromise) => {
    const stdin = process.stdin;
    process.stdout.write(`${promptText}: `);
    let value = "";
    const wasRaw = stdin.isRaw === true;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk) => {
      // Drop escape sequences whole — an arrow key must not end up in the key.
      const text = String(chunk)
        .replace(/\u001b\[[0-9;]*[A-Za-z~]/g, "")
        .replace(/\u001b./g, "");
      for (const ch of text) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          cleanup();
          process.stdout.write("\n");
          resolvePromise(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\b" || ch === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch < " ") continue;
        value += ch;
      }
    };

    stdin.on("data", onData);
  });
}

async function askSecret(q) {
  const stdin = process.stdin;
  if (stdin.isTTY !== true || typeof stdin.setRawMode !== "function") {
    console.log("     (this terminal cannot hide input — the key will be visible as you type)");
    return (await question(`${q}: `)).trim();
  }
  // readline owns stdin between questions; it has to let go before raw mode.
  closeRl();
  const value = await readSecretRaw(q);
  return value.trim();
}

function requireValue(name, flag, envVar) {
  const how = envVar ? `${flag} (or ${envVar})` : flag;
  die(
    `Missing ${name}. Pass ${how} — this run is non-interactive` +
      `${assumeYes ? " (--yes)" : " (stdin is not a terminal)"}, so there is nothing to prompt.`,
  );
}

/* ── .env templates ──────────────────────────────────────────────────── */

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function terraformEnv({ apiUrl, key, scope }) {
  return [
    "# ── Terraform runner credentials ─────────────────────────────────────────────",
    `# Generated by preflight.mjs on ${stamp} against`,
    `# ${apiUrl}.`,
    "#",
    "# GITIGNORED — terraform/.gitignore excludes .env. Never commit this file.",
    "# The connection key below is the API's ADMIN_CONNECTION_KEY. One key",
    "# administers every scope on the deployment, so treat it as a deployment-wide",
    "# secret. run.sh sources this file and exports the TF_VAR_* the provider reads.",
    "#",
    "# Re-check the prerequisites without touching this file:",
    "#   node preflight.mjs --check",
    "",
    `DATAVERSE_CONTACT_API_URL=${apiUrl}`,
    "",
    "# Must be byte-identical to ADMIN_CONNECTION_KEY on the API deployment — a",
    "# trailing newline or a stray space is enough to make every admin call 401.",
    `DATAVERSE_CONTACT_CONNECTION_KEY=${key}`,
    "",
    `SCOPE=${scope}`,
    "",
  ].join("\n");
}

function appEnv({ apiUrl, scope, tenantId, clientId, apiScope }) {
  return [
    "# ── Portal environment ───────────────────────────────────────────────────────",
    `# Generated by preflight.mjs on ${stamp}. The tenant id and API scope were`,
    `# discovered from ${apiUrl}/.well-known/oauth-protected-resource;`,
    "# the client id is your own SPA app registration.",
    "#",
    "# GITIGNORED — app/.gitignore excludes .env. Nothing secret belongs here in any",
    "# case: every VITE_* value is INLINED INTO THE BROWSER BUNDLE at build time.",
    "#",
    "# Two consequences of \"at build time\":",
    "#   1. Changing one of these on the host does nothing to a bundle that is",
    "#      already built. Rebuild and redeploy after any edit.",
    "#   2. A public SPA client id and a tenant id are meant to be visible. A",
    "#      connection key or a bearer token is not — those never go in a VITE_ var.",
    "",
    "# ── Microsoft Entra External ID (CIAM) — SPA + PKCE ──────────────────────────",
    `VITE_ENTRA_TENANT_ID=${tenantId}`,
    `VITE_ENTRA_CLIENT_ID=${clientId}`,
    "",
    "# The single coarse API scope. The me/team/all permissions are resolved",
    "# server-side from Dataverse, not from the token, so there is nothing",
    "# per-tier to ask for here.",
    `VITE_ENTRA_API_SCOPE=${apiScope}`,
    "",
    "# ── The API ──────────────────────────────────────────────────────────────────",
    "# ORIGIN ONLY, no path. The SDK builds every URL as",
    "# `${VITE_API_BASE_URL}/api/v2/${VITE_API_SCOPE}${path}`.",
    `VITE_API_BASE_URL=${apiUrl}`,
    `VITE_API_SCOPE=${scope}`,
    "",
  ].join("\n");
}

/* ── main ────────────────────────────────────────────────────────────── */

console.log("Dataverse Contact API — help desk pack preflight");
console.log(checkOnly ? "Mode: --check (nothing will be written)" : `Writing to: ${outDir}`);

const terraformEnvPath = join(outDir, "terraform", ".env");
const appEnvPath = join(outDir, "app", ".env");

// Refuse early, before asking anyone to type a connection key they will not get
// to use. --force is the only way past this.
if (!checkOnly && !force) {
  const clashes = [terraformEnvPath, appEnvPath].filter((p) => existsSync(p));
  if (clashes.length) {
    console.error("");
    for (const p of clashes) console.error(`  exists: ${p}`);
    die(
      "Refusing to overwrite an existing .env. Pass --force to replace it, " +
        "or --check to run the checks without writing anything.",
    );
  }
}

/* ── 1. the API URL, and what it tells us about itself ───────────────── */

let apiUrlRaw = str(args.url) ?? str(process.env.DATAVERSE_CONTACT_API_URL);
if (!apiUrlRaw) {
  if (!interactive) requireValue("API URL", "--url", "DATAVERSE_CONTACT_API_URL");
  heading("Contact API");
  info("The base URL of the Contact API deployment — origin only, no path.");
  apiUrlRaw = await ask("API URL", DEFAULT_URL);
}

const normalised = normaliseApiUrl(apiUrlRaw);
if (!normalised) die(`"${apiUrlRaw}" is not a usable URL.`);
const apiUrl = normalised.url;
if (normalised.dropped) {
  warn(`Dropped "${normalised.dropped}" from the URL — the base must be the origin only.`);
}

heading("1. Is this a Contact API?");

const wellKnown = await getJson(`${apiUrl}/.well-known/oauth-protected-resource`);

if (wellKnown.networkError) {
  fail(`${apiUrl} — ${wellKnown.networkError}`);
  info("Check the host name, and that the deployment is up.");
  process.exit(1);
}
if (!wellKnown.ok) {
  fail(`GET ${apiUrl}/.well-known/oauth-protected-resource -> ${wellKnown.status}`);
  info("Either the URL is wrong, or this host is not a Dataverse Contact API.");
  info("The metadata document is public — no credentials are needed to read it.");
  process.exit(1);
}
if (!wellKnown.json || !wellKnown.json.idp_issuer) {
  fail("The metadata document has no idp_issuer — this is not a Contact API.");
  process.exit(1);
}

const meta = wellKnown.json;

// Read idp_provider / idp_issuer / idp_audience ONLY. The auth0_* fields are
// back-compat aliases kept for older SDK versions: on an Entra deployment
// auth0_domain holds a ciamlogin URL, so reading them "because they are more
// familiar" gives you an Entra tenant dressed up as an Auth0 one.
const provider = String(meta.idp_provider ?? "").toLowerCase();
const issuer = String(meta.idp_issuer);
const audience = meta.idp_audience;

ok(`Contact API reachable at ${apiUrl}`);
info(`Identity provider: ${meta.idp_provider ?? "(not stated)"}`);

if (!/^entra/.test(provider) && !/azure[-_ ]?ad/.test(provider)) {
  fail(`Unsupported identity provider "${meta.idp_provider}".`);
  info("This pack only handles Microsoft Entra External ID. The app's sign-in");
  info("code, the redirect-URI rules and the token shape all assume it.");
  process.exit(1);
}

const tenantId = extractTenantId(issuer);
if (!tenantId) {
  fail(`Could not read a tenant id out of idp_issuer: ${issuer}`);
  info("Expected https://<tenantId>.ciamlogin.com/<tenantId>/v2.0 with a GUID tenant id.");
  process.exit(1);
}
ok(`Tenant id discovered: ${tenantId}`);

const apiScope = apiScopeFromAudience(audience);
if (!apiScope) {
  fail(`Could not build an API scope from idp_audience: ${JSON.stringify(audience)}`);
  process.exit(1);
}
ok(`API scope discovered: ${apiScope}`);

/* ── the scope name ──────────────────────────────────────────────────── */

let scope = str(args.scope) ?? str(process.env.SCOPE);
if (!scope) {
  if (interactive) {
    heading("Scope");
    info("The API scope partition holding the help desk tables.");
    scope = await ask("Scope", DEFAULT_SCOPE);
  } else {
    scope = DEFAULT_SCOPE;
  }
}
scope = scope.toLowerCase();

/* ── the connection key ──────────────────────────────────────────────── */

let key = str(args.key) ?? str(process.env.DATAVERSE_CONTACT_CONNECTION_KEY);
const keyFromEnv = !str(args.key) && Boolean(key);

if (!key) {
  if (interactive) {
    heading("Connection key");
    info("The API's ADMIN_CONNECTION_KEY. Terraform sends it as the admin bearer");
    info("token. Set DATAVERSE_CONTACT_CONNECTION_KEY to skip this prompt next time.");
    info("");
    info("It is an app setting on the API's App Service, so if you have Azure");
    info("rights you can read it rather than being told it:");
    info("");
    info("  az webapp config appsettings list --name <app> --resource-group <rg> \\");
    info("    --query \"[?name=='ADMIN_CONNECTION_KEY'].value\" -o tsv");
    info("");
    info("Empty output means the deployment never had one — that is a normal");
    info("state, not a mistake. An Entra token works instead:");
    info("");
    info("  az account get-access-token --resource <dataverse-url> \\");
    info("    --query accessToken -o tsv");
    info("");
    info("Either way it arrives here as a bearer token; nothing inspects which.");
    if (checkOnly) info("Leave it blank to skip the checks that need it.");
    key = await askSecret("Connection key");
    if (!key) key = undefined;
  } else if (!checkOnly) {
    requireValue("connection key", "--key", "DATAVERSE_CONTACT_CONNECTION_KEY");
  }
}

if (key) {
  const trimmed = key.replace(/^\s+|\s+$/g, "");
  if (trimmed !== key) {
    warn("Stripped whitespace from the connection key — it must be byte-identical");
    info("to ADMIN_CONNECTION_KEY, and a trailing newline alone causes a 401.");
    key = trimmed;
  }
}

/* ── 2. is the admin key right? ──────────────────────────────────────── */

heading("2. Is the admin connection key right?");

let scopeList = null;
let scopeAuth = [];

if (!key) {
  skip("No connection key supplied — key and scope checks not run.");
} else {
  info(`Using key ${maskKey(key)}${keyFromEnv ? " (from DATAVERSE_CONTACT_CONNECTION_KEY)" : ""}`);
  const scopesRes = await getJson(`${apiUrl}/api/v2/_admin/scopes`, { key });
  if (scopesRes.networkError) {
    fail(`GET /api/v2/_admin/scopes — ${scopesRes.networkError}`);
  } else if (scopesRes.status === 401 || scopesRes.status === 403) {
    fail(`Admin key rejected (${scopesRes.status}).`);
    info("The key must be byte-identical to ADMIN_CONNECTION_KEY on the API");
    info("deployment. Copy it again rather than retyping it.");
  } else if (!scopesRes.ok) {
    fail(`GET /api/v2/_admin/scopes -> ${scopesRes.status}`);
  } else {
    scopeList = Array.isArray(scopesRes.json?.scopes) ? scopesRes.json.scopes : [];
    scopeAuth = Array.isArray(scopesRes.json?.scopeAuth) ? scopesRes.json.scopeAuth : [];
    info(`Scopes on this deployment: ${scopeList.length ? scopeList.join(", ") : "(none)"}`);

    // Some deployments serve /_admin/scopes unauthenticated — it lists scope
    // names and authorities, no secrets. A 200 there therefore proves nothing
    // about the key, so confirm it against an endpoint that does enforce auth.
    const probe = await getJson(`${apiUrl}/api/v2/_admin/${scope}/table-definitions`, { key });
    if (probe.status === 401 || probe.status === 403) {
      fail(`Admin key rejected (${probe.status}).`);
      info("The scope list is public on this deployment, so its 200 was not proof.");
      info("The key must be byte-identical to ADMIN_CONNECTION_KEY on the API.");
    } else if (probe.networkError) {
      warn(`Could not confirm the key — ${probe.networkError}`);
    } else {
      ok("Admin key accepted.");
    }
  }
}

/* ── 3. does the scope exist yet? ────────────────────────────────────── */

heading(`3. Does the "${scope}" scope exist?`);

if (!scopeList) {
  skip("No scope list to read — needs a working connection key.");
} else if (scopeList.includes(scope)) {
  const auth = scopeAuth.find((s) => s?.name === scope);
  ok(`"${scope}" exists on this deployment.`);
  if (auth?.apiScope) info(`Dataverse environment: ${auth.apiScope}`);
} else {
  ok(`"${scope}" is not published yet — \`terraform apply\` will create it.`);
  info("That is the normal state before the first apply, not an error.");
  info("Set the scope's Dataverse connection on the API deployment first:");
  info(
    `  ${scope.toUpperCase()}__DATAVERSE_URL, ${scope.toUpperCase()}__AZURE_TENANT_ID,` +
      ` ${scope.toUpperCase()}__AZURE_CLIENT_ID, ${scope.toUpperCase()}__AZURE_CLIENT_SECRET`,
  );
  info("Without them the API falls back to the DEFAULT scope's connection and the");
  info("publish validates against the wrong Dataverse environment.");
}

/* ── 4. is the scope's table config published? ───────────────────────── */

heading(`4. Is the "${scope}" table config published?`);

const schemaRes = await getJson(`${apiUrl}/api/v2/${scope}/schema`);

if (schemaRes.networkError) {
  fail(`GET /api/v2/${scope}/schema — ${schemaRes.networkError}`);
} else if (!schemaRes.ok) {
  fail(`GET /api/v2/${scope}/schema -> ${schemaRes.status}`);
} else {
  const tables = Array.isArray(schemaRes.json?.tables) ? schemaRes.json.tables : [];
  const names = tables.map((t) => String(t?.name ?? "")).filter(Boolean);
  const hasExpected = tables.some(
    (t) =>
      String(t?.name ?? "") === EXPECTED_ROUTE ||
      (Array.isArray(t?.aliases) && t.aliases.includes(EXPECTED_ROUTE)),
  );

  if (hasExpected) {
    ok(`Published — the "${EXPECTED_ROUTE}" route is live.`);
    info(`Routes: ${names.join(", ")}`);
    if (schemaRes.json?.dataverseUrl) info(`Dataverse: ${schemaRes.json.dataverseUrl}`);
  } else if (names.length === 0) {
    // The schema endpoint answers 200 with an empty table list for a scope that
    // does not exist, so "empty" and "unknown scope" look identical here.
    ok(`No routes published yet — \`terraform apply\` will create them.`);
    info("Normal before the first apply.");
  } else {
    warn(`Published, but there is no "${EXPECTED_ROUTE}" route in this scope.`);
    info(`Routes: ${names.join(", ")}`);
    info("Either the scope name is wrong, or this scope belongs to another app.");
  }
}

/* ── 5. the check no script can run for you ──────────────────────────── */

heading("5. Does your sign-in account have a contact row?");

warn("Cannot be checked without a user token — check it by hand after sign-in.");
info("The API resolves the Dataverse contact from the token's lowercased `email`");
info("claim against contact.emailaddress1. Not the object id, not the subject.");
info("An account whose email matches no contact row authenticates perfectly and");
info("then 404s on every /me route — a working app that shows nothing.");
info("");
info("With a token from the running app (DevTools → Network → any API call):");
info(`  curl -H "Authorization: Bearer $TOKEN" \\`);
info(`    "${apiUrl}/api/v2/${scope}/me/whoami"`);
info("");
info('`"dataverseContact": null` in the response means: authenticated fine, no');
info("contact row. Fix it with a contact row whose emailaddress1 matches the");
info("account's email exactly, or sign in as somebody who has one.");

/* ── write ───────────────────────────────────────────────────────────── */

if (checkOnly) {
  heading("Result");
  console.log(`${failures} failed, ${skipped} skipped.`);
  if (skipped) console.log("Not a complete readiness check — see the SKIP lines above.");
  console.log("Nothing written (--check).");
  if (rl) rl.close();
  process.exit(failures ? 1 : 0);
}

if (failures) {
  heading("Result");
  console.log(`${failures} check(s) failed. Nothing written.`);
  console.log("Fix the failures above and run again.");
  if (rl) rl.close();
  process.exit(1);
}

/* ── the SPA client id — the one value nothing can discover ──────────── */

let clientId = str(args["spa-client-id"]) ?? str(process.env.VITE_ENTRA_CLIENT_ID);

if (!clientId) {
  if (!interactive) requireValue("SPA client id", "--spa-client-id");
  heading("SPA client id");
  info("The Application (client) ID of the single-page application registered in");
  info(`your Entra External ID tenant (${tenantId}), granted the`);
  info(`${apiScope} scope. It is not discoverable from the API — the API`);
  info("does not know which apps call it.");
  info("Entra admin centre → App registrations → your SPA → Overview.");
  for (let attempt = 0; attempt < 3 && !clientId; attempt++) {
    const answer = await ask("SPA client id (GUID)");
    if (isGuid(answer)) clientId = answer.toLowerCase();
    else if (answer) console.log(`     "${answer}" is not a GUID.`);
  }
  if (!clientId) die("No valid SPA client id given.");
}

if (!isGuid(clientId)) {
  die(`SPA client id "${clientId}" is not a GUID. It is the Application (client) ID of your app registration.`);
}
clientId = clientId.toLowerCase();

/* ── directories ─────────────────────────────────────────────────────── */

heading("Writing");

const missingDirs = ["terraform", "app"].filter((d) => !existsSync(join(outDir, d)));
if (missingDirs.length) {
  warn(`${outDir} does not look like a pack directory.`);
  info(`Missing: ${missingDirs.map((d) => `${d}/`).join(", ")}`);
  info("A pack has terraform/ and app/ side by side. If --out is wrong, the .env");
  info("files will land somewhere the pack never reads them.");
  let proceed = true;
  if (interactive) {
    const answer = await ask("Write there anyway, creating the directories? (y/N)", "N");
    proceed = /^y(es)?$/i.test(answer);
  } else {
    info("Proceeding anyway and creating them (non-interactive).");
  }
  if (!proceed) die("Stopped. Re-run with --out pointing at the pack directory.");
}

for (const p of [terraformEnvPath, appEnvPath]) {
  mkdirSync(join(p, ".."), { recursive: true });
}

writeFileSync(terraformEnvPath, terraformEnv({ apiUrl, key, scope }), "utf8");
writeFileSync(appEnvPath, appEnv({ apiUrl, scope, tenantId, clientId, apiScope }), "utf8");

ok(`${terraformEnvPath}`);
info(`DATAVERSE_CONTACT_API_URL=${apiUrl}`);
info(`DATAVERSE_CONTACT_CONNECTION_KEY=${maskKey(key)}`);
info(`SCOPE=${scope}`);
ok(`${appEnvPath}`);
info(`VITE_ENTRA_TENANT_ID=${tenantId}`);
info(`VITE_ENTRA_CLIENT_ID=${clientId}`);
info(`VITE_ENTRA_API_SCOPE=${apiScope}`);
info(`VITE_API_BASE_URL=${apiUrl}`);
info(`VITE_API_SCOPE=${scope}`);

heading("Next");
console.log("  1. Register these redirect URIs on the SPA app registration, under");
console.log("     Authentication → Single-page application (NOT Web), character for");
console.log("     character and with NO trailing slash:");
console.log("       http://localhost:5175");
console.log("       https://<your-deployment-host>");
console.log("     Entra compares the string exactly; a trailing slash fails at the");
console.log("     identity provider with AADSTS50011, before the app runs at all.");
console.log("  2. cd terraform && bash run.sh plan   # then apply");
console.log("  3. cd app && npm install && npm run dev");
console.log(`  4. Sign in, then confirm the contact resolves: /api/v2/${scope}/me/whoami`);

if (rl) rl.close();
process.exit(0);
