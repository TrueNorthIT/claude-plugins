#!/usr/bin/env node

/**
 * scan.mjs — the mechanical first pass of a Contact API portal review.
 *
 * Walks a React portal's source and config for the patterns that most often
 * leak data or sessions: calls through the `all` tier, HTML sinks, secrets in
 * VITE_* variables (and in the built bundle), token handling, raw API errors
 * on screen, analytics, missing security headers. With --schema it also reads
 * the scope's published schema — public, no credentials — for writable
 * identity columns and other route-level problems.
 *
 * Every result is a CANDIDATE. A pattern match can't tell a staff portal's
 * deliberate `client.all` from a citizen portal's mistake, so each one needs
 * a judgement — see ../references/checks.md, keyed by the same ids.
 *
 * Read-only. Never prints a secret's value, only the variable's name.
 *
 * Usage:
 *   node scan.mjs [--root <dir>] [--json] [--schema [--api <url>] [--scope <name>]]
 *                 [--include-tests] [--strict]
 *
 * --strict exits 1 when anything is rated high (for CI). Otherwise exit 0.
 * Node 20+. No dependencies.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";
import { execFileSync } from "node:child_process";

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

const args = parseArgs(process.argv.slice(2));
const root = typeof args.root === "string" ? args.root : ".";
const asJson = args.json === true;
const includeTests = args["include-tests"] === true;

if (!existsSync(join(root, "package.json"))) {
  console.error(`ERROR: no package.json in ${root} — point --root at the portal's directory.`);
  process.exit(2);
}

/* ── files ───────────────────────────────────────────────────────────── */

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".vercel",
  ".turbo", ".cache", "playwright-report", "test-results", "allure-results",
  "allure-report", "storybook-static",
]);
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const TEST_PATH = /(^|[\\/])(__tests__|tests?|e2e|cypress|playwright)([\\/]|$)|\.(test|spec|stories)\.[cm]?[jt]sx?$/;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

const allFiles = walk(root);
const rel = (f) => relative(root, f).replace(/\\/g, "/");
const read = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

const codeFiles = allFiles.filter((f) => {
  if (!CODE_EXT.has(extname(f)) || f.endsWith(".d.ts")) return false;
  if (rel(f).startsWith("scripts/")) return false; // node tooling, not shipped to the browser
  return includeTests || !TEST_PATH.test(rel(f));
});
const envFiles = allFiles.filter((f) => /^\.env(\..+)?$/.test(basename(f)) && !rel(f).includes("/node_modules/"));
const configNames = new Set([
  "vercel.json", "staticwebapp.config.json", "netlify.toml", "_headers",
  "web.config", "index.html", "nginx.conf", "default.conf", "Caddyfile",
]);
const configFiles = allFiles.filter((f) => configNames.has(basename(f)) || /nginx.*\.conf$/.test(basename(f)));

/* ── findings ────────────────────────────────────────────────────────── */

const findings = [];
const notes = [];
function add(id, severity, title, file, line, text) {
  findings.push({
    id,
    severity,
    title,
    file: file ? rel(file) : null,
    line: line ?? null,
    text: text ? text.trim().slice(0, 160) : null,
  });
}

const sources = codeFiles.map((f) => ({ f, text: read(f) }));
const everything = sources.map((s) => s.text).join("\n");
const pkg = JSON.parse(read(join(root, "package.json")) || "{}");
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/* Line rules: one regex per pattern, applied to every non-comment source line. */
const LINE_RULES = [
  {
    id: "tier-all",
    severity: "high",
    title: "Call through the `all` tier — every row in the table",
    re: /\bclient\.all\b|\.all\.(list|get|update|lookup|aggregate|fetchPage|eachPage)\s*[<(]/,
  },
  {
    id: "tier-team",
    severity: "low",
    title: "Call through the `team` tier — confirm the portal means colleagues' rows",
    re: /\.team\.(list|get|update|lookup|aggregate|fetchPage|eachPage)\s*[<(]/,
  },
  {
    id: "token-log",
    severity: "high",
    title: "A token or Authorization header written to the console",
    re: /console\.\w+\([^)]*\b(access_?token|accessToken|idToken|id_token|bearer|authorization)\b/i,
  },
  {
    id: "token-storage",
    severity: "medium",
    title: "A token stored by hand in web storage",
    re: /(localStorage|sessionStorage)\.setItem\([^)]*token/i,
  },
  {
    id: "token-in-url",
    severity: "medium",
    title: "A token placed in a URL",
    re: /[?&](access_token|id_token|token)=\$\{/,
  },
  {
    id: "dynamic-env",
    severity: "medium",
    title: "Dynamic read of import.meta.env — Vite inlines every VITE_* variable",
    re: /import\.meta\.env\s*\[|\.\.\.import\.meta\.env\b|(Object\.\w+|JSON\.stringify)\(\s*import\.meta\.env\s*\)/,
  },
  {
    id: "msal-local-storage",
    severity: "medium",
    title: "MSAL token cache in localStorage",
    re: /cacheLocation\s*:\s*(["']localStorage["']|BrowserCacheLocation\.LocalStorage)/,
  },
  {
    id: "msal-popup",
    severity: "low",
    title: "Popup sign-in — blocked by browsers, poor on phones; use redirects",
    re: /\b(loginPopup|acquireTokenPopup|logoutPopup)\s*\(/,
  },
  {
    id: "raw-error",
    severity: "medium",
    title: "API error text passed to the UI — check what a citizen sees",
    // Rendered directly ({err.message}, toast(err.message)), or lifted into
    // state that is rendered elsewhere (x instanceof Error ? x.message : …,
    // setError(e.message), errorMessage: err.message).
    re: /\{\s*[\w.]*?\b(error|err|e)\??\.message\s*\}|toast\.\w+\(\s*[\w.]*?\b(error|err|e)\??\.message|\.body\??\.message\b|instanceof\s+(Error|ApiError)\s*\?\s*[\w.]+\.message|set\w*Error\(\s*[^)]*\.message|\b\w*[Ee]rror\w*\s*:\s*[^,;\n]*\.message\b/,
  },
  {
    id: "analytics-identify",
    severity: "high",
    title: "An email address sent to an analytics or session-replay service",
    re: /\b(identify|setUser|set_user|identifyUser)\s*\([^)]*\bemail\b|["']identify["'][^)]*\bemail\b/i,
  },
  {
    id: "analytics",
    severity: "medium",
    title: "Analytics or session replay — confirm consent gating and masking",
    re: /from\s+["'](@microsoft\/clarity|clarity-js|react-hotjar|@hotjar\/[\w-]+|posthog-js|mixpanel-browser|@segment\/[\w-]+|@fullstory\/[\w-]+|logrocket|smartlook-client|@amplitude\/[\w-]+|react-ga4?)["']|https?:\/\/[^"'\s]*(clarity\.ms|hotjar\.com|googletagmanager\.com|google-analytics\.com|posthog\.com|mixpanel\.com|fullstory\.com|logrocket\.(com|io)|cdn\.segment\.com)/i,
  },
  {
    id: "persisted-cache",
    severity: "medium",
    title: "Query cache persisted to storage",
    re: /persistQueryClient|createSyncStoragePersister|createAsyncStoragePersister|PersistQueryClientProvider/,
  },
  {
    id: "email-gate",
    severity: "medium",
    title: "UI gated on an email address — cosmetic, not a control",
    re: /\bemail\b[^\n=]{0,40}===?\s*["'][^"'\s@]+@[^"'\s]+["']|\.endsWith\(\s*["']@/,
  },
  {
    id: "redirect-param",
    severity: "medium",
    title: "Post-login destination read from the query string",
    re: /searchParams\.get\(\s*["'](returnTo|returnUrl|return_url|redirect|redirectTo|redirect_uri|next)["']\s*\)/,
  },
  {
    id: "fetchpage-arg",
    severity: "low",
    title: "fetchPage given something other than page.next — it sends the token to any URL",
    re: /fetchPage(?:<[^>]*>)?\(\s*(?![^)]*\b(next|pageParam)\b)[^)\s]/,
  },
  {
    id: "public-invoke",
    severity: "low",
    title: "SDK invoke on client.public — sends no token, so only reaches publicInvoke APIs",
    re: /\.public\.invoke(Function|Action)\s*[<(]/,
  },
  {
    id: "href-from-data",
    severity: deps.react && /^[\^~]?1[0-8]\./.test(String(deps.react)) ? "medium" : "low",
    title: "Link built from a data value — check its scheme",
    re: /\bhref=\{\s*(?!["'`])[\w$.?[\]]+\s*\}|window\.open\(\s*(?!["'`])[\w$.]+/,
  },
  {
    id: "debug-switch",
    severity: "low",
    title: "Client-side debug switch anyone can flip",
    re: /localStorage\.getItem\(\s*["'][\w.-]*debug[\w.-]*["']\s*\)/i,
  },
];

const HTML_SINK = /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/;
const HANDMADE_SANITIZER = /(function\s+sanitize\w*\s*\(|(const|let|var)\s+sanitize\w*\s*=|replace\(\s*\/<\s*script)/i;

// `el.innerHTML = '<span>' + '</span>'` — string literals only, possibly over
// several lines joined by `+`. Anything else left over (a variable, a ${…})
// makes it dynamic.
function staticHtmlAssignment(lines, i) {
  const at = lines[i].search(/(innerHTML|outerHTML)\s*=(?!=)/);
  if (at < 0) return false;
  let stmt = lines[i].slice(at).replace(/^(innerHTML|outerHTML)\s*=/, "");
  let j = i;
  while (j + 1 < lines.length && j - i < 12 && (/[=+]\s*$/.test(lines[j]) || /^\s*\+/.test(lines[j + 1]))) {
    j++;
    stmt += "\n" + lines[j];
  }
  const rest = stmt
    .replace(/;\s*$/, "")
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`/g, "");
  return /^[\s+()]*$/.test(rest);
}

for (const { f, text } of sources) {
  const lines = text.split(/\r?\n/);
  const usesPurify = /dompurify/i.test(text);
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const rule of LINE_RULES) {
      if (rule.re.test(line)) add(rule.id, rule.severity, rule.title, f, i + 1, line);
    }
    if (HTML_SINK.test(line)) {
      if (/DOMPurify\.sanitize|sanitize\(/.test(line) && usesPurify) {
        add("html-sanitised", "low", "HTML sink through DOMPurify — check its configuration", f, i + 1, line);
      } else if (staticHtmlAssignment(lines, i)) {
        add("html-static", "low", "HTML sink with a static string", f, i + 1, line);
      } else {
        add("html-sink", "high", "HTML sink not visibly passed through DOMPurify", f, i + 1, line);
      }
    }
    if (HANDMADE_SANITIZER.test(line) && !usesPurify) {
      add("handmade-sanitizer", "high", "Hand-written HTML sanitiser — use an allow-list sanitiser (DOMPurify)", f, i + 1, line);
    }
  });
}

/* ── whole-repo rules ────────────────────────────────────────────────── */

const usesMsal = Boolean(deps["@azure/msal-browser"]) || /@azure\/msal-browser/.test(everything);
if (usesMsal && !/\blogoutRedirect\s*\(/.test(everything)) {
  add("no-logout", "medium", "MSAL is used but nothing calls logoutRedirect — no way to end the session", null, null, null);
}

if (deps.react && /^[\^~]?1[0-8]\./.test(String(deps.react))) {
  add("react-version", "low", `React ${deps.react} only warns on javascript: URLs; React 19 blocks them`, join(root, "package.json"), null, null);
}

// Route params reaching the API with no GUID check anywhere in the source.
const paramUses = [];
for (const { f, text } of sources) {
  text.split(/\r?\n/).forEach((line, i) => {
    if (/\buseParams\s*[<(]/.test(line) && !isComment(line)) paramUses.push([f, i + 1, line]);
  });
}
const hasGuidCheck = /\[0-9a-f\]\{8\}|isUuid|isGuid|uuidValidate|validate as uuidValidate/i.test(everything);
if (paramUses.length && !hasGuidCheck) {
  for (const [f, line, text] of paramUses) {
    add("route-param", "medium", "Route param reaches the API with no GUID check anywhere in src", f, line, text);
  }
}

// Company switcher: query keys that don't carry the selected company.
if (/\bwithCompany\s*\(|\bcompanyId\s*[:=]/.test(everything)) {
  for (const { f, text } of sources) {
    text.split(/\r?\n/).forEach((line, i) => {
      // Invalidations take prefixes, so only a query's own key is checked.
      const invalidation = /(invalidate|remove|refetch|cancel|reset)Queries|setQueryData|getQueryData/.test(line);
      if (/queryKey\s*:\s*\[/.test(line) && !/compan/i.test(line) && !invalidation && !isComment(line)) {
        add("company-key", "low", "Query key without the selected company — check it can't show one company's rows under another", f, i + 1, line);
      }
    });
  }
}

// Security headers: CSP and frame protection in whatever host config the repo has.
const configText = configFiles.map((f) => read(f)).join("\n");
if (!/Content-Security-Policy/i.test(configText)) {
  add("no-csp", "medium", "No Content-Security-Policy in the repo's host config (it may be set at the edge — confirm)", null, null, null);
} else if (!/frame-ancestors|X-Frame-Options/i.test(configText)) {
  add("no-frame-protection", "low", "A CSP but no frame-ancestors / X-Frame-Options", null, null, null);
}

/* ── env files, git, bundle ──────────────────────────────────────────── */

const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|PRIVATE|CONNECTION|ACCESS_?KEY|(WEBPUBSUB|SIGNALR)\w*KEY|TOKEN)/i;
const KEYISH_NAME = /(_KEY|APIKEY|API_KEY)$/i;
const secretValues = []; // [name, value, file] — kept in memory, never printed

for (const f of envFiles) {
  const name = basename(f);
  read(f).split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) return;
    const [, key, rawValue] = m;
    const value = rawValue.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    if (!value) return;
    // Values worth hunting for in the bundle: anything secret-named, plus
    // server-side keys. A VITE_*_KEY is expected in the bundle (it's flagged
    // separately as "confirm it's publishable").
    const huntable = SECRET_NAME.test(key) || (!key.startsWith("VITE_") && KEYISH_NAME.test(key));
    if (huntable && value.length >= 12) secretValues.push([key, value, f]);
    if (!key.startsWith("VITE_")) return;

    if (key === "VITE_DEMO_TOKEN") {
      if (name !== ".env.development.local") {
        add("demo-token-file", "high", `VITE_DEMO_TOKEN in ${name} — only .env.development.local is dev-only and untracked`, f, i + 1, `${key}=…`);
      }
    } else if (SECRET_NAME.test(key)) {
      add("vite-secret", "high", `${key} looks like a secret, and every VITE_* variable the code reads ships to the browser`, f, i + 1, `${key}=…`);
    } else if (KEYISH_NAME.test(key)) {
      add("vite-key", "low", `${key} ships to the browser — confirm it is a publishable key`, f, i + 1, `${key}=…`);
    }
  });
}

if (existsSync(join(root, ".git"))) {
  try {
    const tracked = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .filter((p) => /(^|\/)\.env(\.|$)/.test(p) && !/\.(example|sample|tpl|template)$/.test(p));
    for (const p of tracked) add("env-tracked", "medium", `${p} is tracked by git`, join(root, p), null, null);
  } catch {
    notes.push("git ls-files failed — tracked .env files not checked.");
  }
}

const gitignore = read(join(root, ".gitignore"));
if (gitignore) {
  const ignores = (pattern) => gitignore.split(/\r?\n/).some((l) => pattern.test(l.trim()));
  if (!ignores(/^\/?\.env(\*|\.\*)?$/)) {
    add("gitignore-env", "low", ".gitignore does not cover .env", join(root, ".gitignore"), null, null);
  }
  if (!ignores(/^(\*\.local|\.env\*|\.env\.\*\.local|\.env\.\*)$/)) {
    add("gitignore-local", "low", ".gitignore does not cover .env.*.local (or *.local)", join(root, ".gitignore"), null, null);
  }
}

for (const outDir of ["dist", "build"]) {
  const dir = join(root, outDir);
  if (!existsSync(dir) || secretValues.length === 0) continue;
  const bundle = walk(dir).filter((f) => /\.(js|mjs|html|map|json)$/.test(f));
  for (const [key, value, envFile] of secretValues) {
    for (const f of bundle) {
      if (read(f).includes(value)) {
        add("bundle-secret", "high", `The value of ${key} (from ${basename(envFile)}) is in the built bundle`, f, null, null);
        break;
      }
    }
  }
}

/* ── scope schema (opt-in, public endpoint) ──────────────────────────── */

function envValue(key) {
  for (const f of envFiles) {
    const m = read(f).match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
    if (m && m[1].trim()) return m[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

if (args.schema) {
  // The base URL is normally the origin, but some portals bake the scope into
  // it (…/api/v2/<scope>); take the scope from there when nothing else names it.
  const baseUrl = (typeof args.api === "string" ? args.api : envValue("VITE_API_BASE_URL") ?? "").replace(/\/+$/, "");
  const parts = baseUrl.match(/^(https?:\/\/[^/]+)(?:\/api\/v2\/([^/?#]+))?/);
  const api = parts ? parts[1] : "";
  const scope = typeof args.scope === "string" ? args.scope : envValue("VITE_API_SCOPE") ?? parts?.[2] ?? null;
  if (!api || !scope) {
    notes.push("Schema check skipped: pass --api and --scope (or set VITE_API_BASE_URL and VITE_API_SCOPE in an .env file).");
  } else {
    const url = `${api}/api/v2/${scope}/schema`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const { tables = [] } = await res.json();
      for (const t of tables) {
        const where = `${scope}/${t.name}`;
        const byName = new Map((t.fields ?? []).map((fld) => [fld.name, fld]));
        const writable = (n) => byName.has(n) && !byName.get(n).readOnly;
        if (t.dataverseLogicalName === "contact" && writable("emailaddress1")) {
          add("schema-email-writable", "high", `${where}: emailaddress1 is writable — it is the key the API matches sign-ins to`, null, null, null);
        }
        for (const link of ["parentcustomerid", "parentcustomerid_account"]) {
          if (writable(link)) add("schema-company-link-writable", "high", `${where}: ${link} is writable — it decides which company's team rows the caller sees`, null, null, null);
        }
        for (const d of t.createDefaults ?? []) {
          if (writable(d.field) || writable(String(d.field).toLowerCase())) {
            add("schema-createdefault-writable", "medium", `${where}: ${d.field} is bound by createDefaults but writable — the caller can re-point it after create`, null, null, null);
          }
        }
        for (const fld of t.fields ?? []) {
          if (fld.type === "lookup" && !fld.readOnly && !fld.lookupTable) {
            add("schema-lookup-unchecked", "medium", `${where}: writable lookup ${fld.name} has no lookupTable, so writes to it aren't checked against the caller's rows`, null, null, null);
          }
        }
        const status = ["statecode", "statuscode", "prioritycode"].filter(writable);
        if (status.length) add("schema-status-writable", "low", `${where}: ${status.join(", ")} writable — confirm citizens should set these`, null, null, null);
        if (Array.isArray(t.defaultFields) && t.defaultFields.length === 0) {
          add("schema-empty-default-select", "high", `${where}: default select is empty, which the API treats as no projection`, null, null, null);
        }
        for (const ex of t.expands ?? []) {
          if (!ex.fields || ex.fields.length === 0) add("schema-expand-no-fields", "medium", `${where}: expand ${ex.lookupField} lists no fields`, null, null, null);
        }
        if (t.publicRead) {
          add("schema-public-read", "low", `${where}: public route — all ${(t.fields ?? []).length} fields readable by anyone, no token`, null, null, null);
        }
      }
      notes.push(`Schema read from ${url} (${tables.length} routes). It does not show publicCreate, fetchXml or the scope's defaults — those need the Terraform config or an admin credential.`);
    } catch (err) {
      notes.push(`Schema check failed for ${url}: ${err.message}`);
    }
  }
}

/* ── report ──────────────────────────────────────────────────────────── */

const ORDER = { high: 0, medium: 1, low: 2 };
findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id) || String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0));
const count = (s) => findings.filter((x) => x.severity === s).length;
const summary = { high: count("high"), medium: count("medium"), low: count("low") };

if (asJson) {
  console.log(JSON.stringify({ root: rel(root) || ".", summary, findings, notes }, null, 2));
} else {
  console.log(`Contact API portal scan — ${root}`);
  console.log(`${findings.length} candidate(s): ${summary.high} high, ${summary.medium} medium, ${summary.low} low.`);
  console.log("Each is a candidate to confirm by reading the code — see references/checks.md.\n");
  for (const sev of ["high", "medium", "low"]) {
    const group = findings.filter((x) => x.severity === sev);
    if (!group.length) continue;
    console.log(sev.toUpperCase());
    const byId = new Map();
    for (const x of group) byId.set(x.id, [...(byId.get(x.id) ?? []), x]);
    for (const [id, items] of byId) {
      const titles = new Set(items.map((x) => x.title));
      if (titles.size === 1) console.log(`  [${id}] ${items[0].title}`);
      else console.log(`  [${id}]`);
      for (const x of items.slice(0, 8)) {
        const loc = x.file ? `${x.file}${x.line ? `:${x.line}` : ""}` : "";
        const detail = titles.size === 1 ? x.text ?? "" : x.title;
        if (loc || detail) console.log(`    ${loc}${loc && detail ? "  " : ""}${detail}`);
      }
      if (items.length > 8) console.log(`    … ${items.length - 8} more`);
    }
    console.log("");
  }
  for (const n of notes) console.log(`note: ${n}`);
  console.log("Not covered by any scan: the app registration, identity-provider settings, edge headers, and the scope's server-side defaults and grants.");
}

// exitCode rather than exit(): exiting while fetch's sockets are still closing
// trips a libuv assertion on Windows.
process.exitCode = args.strict && summary.high > 0 ? 1 : 0;
