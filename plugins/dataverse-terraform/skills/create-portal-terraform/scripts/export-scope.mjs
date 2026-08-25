#!/usr/bin/env node

/**
 * export-scope.mjs — turn a live Dataverse Contact API scope into Terraform.
 *
 * Reads a scope's published table definitions, custom APIs and defaults.json
 * through the admin API — the same endpoints the Terraform provider itself
 * calls — and writes an HCL config that reproduces them exactly, plus an
 * import script so the first `terraform plan` comes back clean.
 *
 * Read-only against the API. Nothing is published, changed or deleted.
 *
 * Usage:
 *   node export-scope.mjs --scope <scope> [--url <api>] [--out <dir>] [--force]
 *   node export-scope.mjs --scope <scope> --new [--out <dir>]
 *
 * --new skips the API entirely and writes the same repo shape around a starter
 * main.tf — for a scope that does not exist yet.
 *
 * Auth: DATAVERSE_CONTACT_CONNECTION_KEY (or --key). This is the same value
 * as ADMIN_CONNECTION_KEY on the API deployment. Not needed for --new.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_URL = "https://api.dataverse-contact.tnapps.co.uk";

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

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const scope = args.scope || process.env.SCOPE;
const apiUrl = String(
  args.url || process.env.DATAVERSE_CONTACT_API_URL || DEFAULT_URL,
).replace(/\/+$/, "");
const key =
  args.key ||
  process.env.DATAVERSE_CONTACT_CONNECTION_KEY ||
  process.env.DATAVERSE_CONTACT_API_KEY;

const isNew = args.new === true;

if (!scope || scope === true) die("Missing --scope (or SCOPE env var).");
if (!key && !isNew) {
  die("Missing connection key — set DATAVERSE_CONTACT_CONNECTION_KEY or pass --key.");
}

const outDir = args.out && args.out !== true ? args.out : `./${scope}-terraform`;

/* ── admin API ───────────────────────────────────────────────────────── */

async function adminGet(path) {
  let res;
  try {
    res = await fetch(`${apiUrl}/api/v2/_admin/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (err) {
    die(`GET /api/v2/_admin/${path} failed: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    die(
      `GET /api/v2/_admin/${path} -> ${res.status} ${res.statusText}\n` +
        `${body.slice(0, 400)}\n` +
        (res.status === 401 || res.status === 403
          ? "The connection key must be byte-identical to ADMIN_CONNECTION_KEY on the API."
          : ""),
    );
  }
  return res.json();
}

/* ── HCL primitives ──────────────────────────────────────────────────── */

// HCL interpolates ${...} and %{...} inside quoted strings and heredocs.
function escapeInterpolation(s) {
  return s.replace(/\$\{/g, "$${").replace(/%\{/g, "%%{");
}

function hclString(v) {
  const s = escapeInterpolation(
    String(v)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/\n/g, "\\n"),
  );
  return `"${s}"`;
}

// Multi-line values (fetch_xml) read far better as a heredoc.
function hclText(v, indent) {
  const s = String(v);
  if (!s.includes("\n")) return hclString(s);
  const pad = " ".repeat(indent);
  const body = escapeInterpolation(s)
    .split("\n")
    .map((line) => `${pad}  ${line}`)
    .join("\n");
  return `<<-EOT\n${body}\n${pad}EOT`;
}

function hclList(arr, indent) {
  if (!arr || arr.length === 0) return "[]";
  const inline = `[${arr.map(hclString).join(", ")}]`;
  if (inline.length <= 78) return inline;
  const pad = " ".repeat(indent + 2);
  return `[\n${arr.map((v) => `${pad}${hclString(v)},`).join("\n")}\n${" ".repeat(indent)}]`;
}

// Bare identifier where legal, quoted otherwise (Dataverse logical names are
// normally [a-z0-9_], but a custom column can carry an odd publisher prefix).
function hclKey(k) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : hclString(k);
}

const usedLabels = new Set();
function tfLabel(routeName) {
  let label = String(routeName)
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1");
  if (usedLabels.has(label)) {
    let n = 2;
    while (usedLabels.has(`${label}_${n}`)) n++;
    label = `${label}_${n}`;
  }
  usedLabels.add(label);
  return label;
}

/* ── table -> HCL ────────────────────────────────────────────────────── */

function emitJoinSteps(blockName, steps, indent) {
  const pad = " ".repeat(indent);
  const out = [];
  for (const s of steps) {
    out.push(`${pad}${blockName} {`);
    out.push(`${pad}  table = ${hclString(s.table)}`);
    out.push(`${pad}  from  = ${hclString(s.from)}`);
    out.push(`${pad}  key   = ${hclString(s.key ?? "")}`);
    if (s.reverse) out.push(`${pad}  reverse = true`);
    out.push(`${pad}}`);
  }
  return out;
}

// A join path read back as a chain of hops, so the generated config says in
// English what its blocks say in HCL: which rows this route calls "yours".
function describeJoin(steps) {
  if (!steps || steps.length === 0) return null;
  return steps
    .map((s) => (s.reverse ? `${s.table} (reverse via ${s.from})` : `${s.table} via ${s.from}`))
    .join(" → ");
}

function emitTable(def, label, perms) {
  const L = [];
  const add = (s) => L.push(s);

  // Banner: what this route is, and who can see it.
  const rule = "─".repeat(Math.max(4, 68 - def.routeName.length));
  add(`# ── ${def.routeName} ${rule}`);
  if (def.description) add(`# ${def.description}`);
  add(`# Dataverse: ${def.dataverseTable}`);
  const me = describeJoin(def.contactJoinPath);
  const team = describeJoin(def.teamJoinPath);
  if (me) add(`# me:   ${me}`);
  if (team) add(`# team: ${team}`);
  const granted = perms?.[def.routeName];
  if (granted) {
    add(`# Baseline grant: ${granted.join(", ")}`);
  } else if (def.publicRead) {
    add(`# No baseline grant — public_read puts this route on the public tier.`);
  } else if (def.permissionGroup) {
    add(`# No baseline grant — inherits the "${def.permissionGroup}" permission group.`);
  } else {
    add(`# No baseline grant and no permission group — callers need an explicit grant.`);
  }
  if (def.publicRead) add(`# PUBLIC READ — readable without authentication.`);
  if (def.publicCreate) add(`# PUBLIC CREATE — unauthenticated POST is allowed.`);
  if (Array.isArray(def.filters) && def.filters.length === 0) {
    add(`# filters = [] clears the statecode default: inactive rows are visible.`);
  }

  add(`resource "dataversecontact_table" "${label}" {`);
  add(`  scope                  = var.scope`);
  add(`  route_name             = ${hclString(def.routeName)}`);
  if (def.description) add(`  description            = ${hclString(def.description)}`);
  if (def.icon) add(`  icon                   = ${hclString(def.icon)}`);
  add(`  dataverse_table        = ${hclString(def.dataverseTable)}`);
  if (def.dataverseLogicalName) {
    add(`  dataverse_logical_name = ${hclString(def.dataverseLogicalName)}`);
  }
  add(`  primary_key            = ${hclString(def.primaryKey)}`);
  if (def.requiredPermission) add(`  required_permission    = ${hclString(def.requiredPermission)}`);
  if (def.permissionGroup) add(`  permission_group       = ${hclString(def.permissionGroup)}`);
  if (def.filters) add(`  filters                = ${hclList(def.filters, 2)}`);
  if (def.aliases && def.aliases.length) add(`  aliases                = ${hclList(def.aliases, 2)}`);
  if (def.publicChoices === false) add(`  public_choices         = false`);
  if (def.publicRead === true) add(`  public_read            = true`);
  if (def.publicCreate === true) add(`  public_create          = true`);
  if (def.fetchXml) add(`  fetch_xml              = ${hclText(def.fetchXml, 2)}`);
  add("");
  add(`  default_select = ${hclList(def.defaultSelect, 2)}`);
  add("");
  add(`  lookup_fields = ${hclList(def.lookupFields, 2)}`);
  // Always emitted: the provider reads this back as [] rather than null, so
  // leaving it out of the config shows up as perpetual drift.
  add(`  lookup_search_contains = ${hclList(def.lookupSearchContains ?? [], 2)}`);

  // Row scoping: how this table joins back to the caller's contact / account.
  if (def.contactJoinPath && def.contactJoinPath.length) {
    add("");
    add("  # me: join back to the signed-in contact");
    L.push(...emitJoinSteps("contact_join_step", def.contactJoinPath, 2));
  }
  if (def.teamJoinPath && def.teamJoinPath.length) {
    add("");
    add("  # team: join back to the caller's account");
    L.push(...emitJoinSteps("team_join_step", def.teamJoinPath, 2));
  }
  for (const path of def.alternateContactJoinPaths ?? []) {
    add("");
    add(`  alternate_contact_join_path {`);
    L.push(...emitJoinSteps("step", path, 4));
    add(`  }`);
  }

  for (const cd of def.createDefaults ?? []) {
    add("");
    add(`  create_default {`);
    add(`    field      = ${hclString(cd.field)}`);
    add(`    bind_to    = ${hclString(cd.bindTo)}`);
    add(`    entity_set = ${hclString(cd.entitySet)}`);
    add(`  }`);
  }

  if (def.parentTable && (def.parentTable.table || def.parentTable.navigationProperty)) {
    add("");
    add(`  parent_table {`);
    if (def.parentTable.table) add(`    table               = ${hclString(def.parentTable.table)}`);
    if (def.parentTable.navigationProperty) {
      add(`    navigation_property = ${hclString(def.parentTable.navigationProperty)}`);
    }
    add(`  }`);
  }

  for (const ex of def.expands ?? []) {
    add("");
    add(`  expand {`);
    add(`    lookup_field  = ${hclString(ex.lookupField)}`);
    add(`    related_table = ${hclString(ex.relatedTable)}`);
    for (const f of ex.fields ?? []) {
      add("");
      add(`    field {`);
      add(`      name        = ${hclString(f.name)}`);
      add(`      type        = ${hclString(f.type)}`);
      add(`      description = ${hclString(f.description ?? "")}`);
      add(`    }`);
    }
    add(`  }`);
  }

  // Fields last — the longest block and the least interesting to skim.
  add("");
  add(`  fields = {`);
  for (const [name, f] of Object.entries(def.fields ?? {})) {
    const parts = [
      `type = ${hclString(f.type)}`,
      `description = ${hclString(f.description ?? "")}`,
    ];
    if (f.readOnly) parts.push("read_only = true");
    if (f.lookupTable) parts.push(`lookup_table = ${hclString(f.lookupTable)}`);
    if (f.valueField) parts.push(`value_field = ${hclString(f.valueField)}`);
    if (f.bindField) parts.push(`bind_field = ${hclString(f.bindField)}`);
    add(`    ${hclKey(name)} = { ${parts.join(", ")} }`);
  }
  add(`  }`);
  add(`}`);
  return L.join("\n");
}

/* ── permissions_sync -> HCL ─────────────────────────────────────────── */

function emitPermissionsSync(defaults, tableRefs, apiRefs) {
  const L = [];
  const add = (s) => L.push(s);
  const perms = defaults.permissions ?? {};

  add(`# Baseline permissions every authenticated caller gets in this scope (the`);
  add(`# scope's defaults.json). A scope with no published defaults grants nothing`);
  add(`# — every route answers 403, reads included.`);
  add(`resource "dataversecontact_permissions_sync" "scope" {`);
  add(`  scope = var.scope`);
  if (defaults.allowSelfRegister !== undefined) {
    add(`  allow_self_register = ${defaults.allowSelfRegister ? "true" : "false"}`);
  }

  if (defaults.companyModel) {
    const cm = defaults.companyModel;
    add("");
    add(`  company_model = {`);
    add(`    strategy = ${hclString(cm.strategy)}`);
    if (cm.associatedAccounts) {
      const aa = cm.associatedAccounts;
      add(`    associated_accounts = {`);
      if (aa.relationship) add(`      relationship       = ${hclString(aa.relationship)}`);
      if (aa.accountIdField) add(`      account_id_field   = ${hclString(aa.accountIdField)}`);
      if (aa.accountNameField) add(`      account_name_field = ${hclString(aa.accountNameField)}`);
      if (aa.fetchXml) add(`      fetch_xml          = ${hclText(aa.fetchXml, 6)}`);
      add(`    }`);
    }
    add(`  }`);
  }

  if (defaults.join) {
    add("");
    add(`  join = {`);
    add(`    strategy      = ${hclString(defaults.join.strategy)}`);
    if (defaults.join.domainField) add(`    domain_field  = ${hclString(defaults.join.domainField)}`);
    if (defaults.join.requireMatch !== undefined) {
      add(`    require_match = ${defaults.join.requireMatch ? "true" : "false"}`);
    }
    add(`  }`);
  }

  add("");
  add(`  default_permissions = {`);
  const width = Math.max(0, ...Object.keys(perms).map((k) => hclKey(k).length));
  for (const [route, actions] of Object.entries(perms)) {
    add(`    ${hclKey(route).padEnd(width)} = ${hclList(actions, 4)}`);
  }
  add(`  }`);

  const allRefs = [...tableRefs, ...apiRefs];
  if (allRefs.length) {
    add("");
    add(`  # Re-publish defaults whenever a route definition changes.`);
    add(`  triggers = {`);
    add(`    routes_hash = sha256(join(",", [`);
    for (const r of allRefs) add(`      ${r}.id,`);
    add(`    ]))`);
    add(`  }`);
    add("");
    add(`  depends_on = [`);
    for (const r of allRefs) add(`    ${r},`);
    add(`  ]`);
  }
  add(`}`);
  return L.join("\n");
}

/* ── file templates ──────────────────────────────────────────────────── */

function variablesTf() {
  return [
    'variable "api_url" {',
    "  type        = string",
    '  description = "Dataverse Contact API base URL"',
    "}",
    "",
    'variable "connection_key" {',
    "  type        = string",
    "  sensitive   = true",
    '  description = "Pre-shared admin connection key. Must equal ADMIN_CONNECTION_KEY on the Contact API. Sent as the admin Bearer token."',
    "}",
    "",
    'variable "scope" {',
    "  type        = string",
    `  default     = ${hclString(scope)}`,
    '  description = "The API scope these routes belong to."',
    "}",
    "",
  ].join("\n");
}

function outputsTf(tableRefs) {
  return [
    'output "scope" {',
    "  value = var.scope",
    "}",
    "",
    'output "published_tables" {',
    "  value = {",
    "    for t in [",
    ...tableRefs.map((r) => `      ${r},`),
    "    ] : t.route_name => {",
    "      id              = t.id",
    "      dataverse_table = t.dataverse_table",
    "      field_count     = t.field_count",
    "    }",
    "  }",
    "}",
    "",
    'output "permission_count" {',
    "  value = dataversecontact_permissions_sync.scope.permission_count",
    "}",
    "",
  ].join("\n");
}

function runSh() {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Loads .env and runs terraform against the Dataverse Contact API.",
    "#",
    "#   bash run.sh plan",
    "#   bash run.sh apply",
    "#   bash run.sh destroy",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'ENV_FILE="${SCRIPT_DIR}/.env"',
    "",
    'if [[ ! -f "$ENV_FILE" ]]; then',
    '  echo "ERROR: $ENV_FILE not found. Copy .env.example and fill in values."',
    "  exit 1",
    "fi",
    "",
    "set -a",
    '# shellcheck disable=SC1090',
    'source "$ENV_FILE"',
    "set +a",
    "",
    'export TF_VAR_api_url="${DATAVERSE_CONTACT_API_URL}"',
    'export TF_VAR_connection_key="${DATAVERSE_CONTACT_CONNECTION_KEY}"',
    '[[ -n "${SCOPE:-}" ]] && export TF_VAR_scope="${SCOPE}"',
    "",
    "# Skip init when dev_overrides point at a locally built provider binary.",
    'TF_RC="${APPDATA:-$HOME}/terraform.rc"',
    'TF_RC_UNIX="$HOME/.terraformrc"',
    'if grep -qs "dev_overrides" "$TF_RC" 2>/dev/null || grep -qs "dev_overrides" "$TF_RC_UNIX" 2>/dev/null; then',
    '  echo "  (skipping init — dev_overrides detected)"',
    "else",
    '  terraform -chdir="$SCRIPT_DIR" init -input=false',
    "fi",
    "",
    "if [[ $# -eq 0 ]]; then",
    '  echo "Usage: bash run.sh <plan|apply|destroy|...>"',
    "  exit 1",
    "fi",
    "",
    'terraform -chdir="$SCRIPT_DIR" "$@" -input=false',
    "",
  ].join("\n");
}

function envExample() {
  return [
    "# Dataverse Contact API — Terraform credentials",
    `DATAVERSE_CONTACT_API_URL=${apiUrl}`,
    "",
    "# The pre-shared admin connection key. Must be byte-identical to",
    "# ADMIN_CONNECTION_KEY on the API deployment. Never commit the filled-in .env.",
    "DATAVERSE_CONTACT_CONNECTION_KEY=",
    "",
    `SCOPE=${scope}`,
    "",
  ].join("\n");
}

function gitignore() {
  return [".env", "*.tfstate", "*.tfstate.*", ".terraform/", "tf.plan", ""].join("\n");
}

function importSh(imports) {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Adopt the routes that already exist in the scope into Terraform state, so",
    "# the first plan is empty instead of proposing to re-create everything.",
    "#",
    "#   bash import.sh",
    "#   bash run.sh plan   # expect: No changes.",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    "set -a",
    '# shellcheck disable=SC1091',
    'source "${SCRIPT_DIR}/.env"',
    "set +a",
    "",
    'export TF_VAR_api_url="${DATAVERSE_CONTACT_API_URL}"',
    'export TF_VAR_connection_key="${DATAVERSE_CONTACT_CONNECTION_KEY}"',
    'export TF_VAR_scope="${SCOPE}"',
    "",
    'terraform -chdir="$SCRIPT_DIR" init -input=false',
    "",
    ...imports.map(
      ([addr, id]) => `terraform -chdir="$SCRIPT_DIR" import '${addr}' "\${SCOPE}/${id}"`,
    ),
    "",
    "# dataversecontact_permissions_sync cannot be imported — it is a publish",
    "# action, not a queryable object. It stays in the plan as \"1 to add\"; the",
    "# apply re-publishes the defaults.json this export already read back, so the",
    "# write is byte-identical to what is live.",
    "",
  ].join("\n");
}

function readme(tableCount, apiCount) {
  const counts =
    `${tableCount} table${tableCount === 1 ? "" : "s"}` +
    (apiCount ? `, ${apiCount} custom API${apiCount === 1 ? "" : "s"}` : "");
  return [
    `# ${scope} — Contact API scope as Terraform`,
    "",
    `The \`${scope}\` scope of the [Dataverse Contact API](${apiUrl}) as code: which`,
    "Dataverse tables are published as routes, which fields callers can read and",
    "write, how each row is scoped back to the signed-in citizen, and the baseline",
    "permissions every authenticated caller gets.",
    "",
    isNew
      ? "Scaffolded as a new scope — a working `contact` route to build out from."
      : `Generated from the live scope — ${counts}.`,
    "",
    "## Setup",
    "",
    "```bash",
    ...(isNew
      ? [
          "cp .env.example .env      # fill in DATAVERSE_CONTACT_CONNECTION_KEY",
          "bash run.sh plan          # review, then:",
          "bash run.sh apply",
        ]
      : [
          "cp .env.example .env      # fill in DATAVERSE_CONTACT_CONNECTION_KEY",
          "bash import.sh            # adopt what already exists into state",
          "bash run.sh plan          # expect: 1 to add (permissions_sync), 0 to change",
        ]),
    "```",
    "",
    "The connection key is the API's `ADMIN_CONNECTION_KEY`. One key administers",
    "every scope, so treat it as a deployment-wide secret — `.env` is gitignored.",
    "",
    "## Making a change",
    "",
    "Edit `main.tf`, then `bash run.sh plan` and `bash run.sh apply`. Each",
    "`dataversecontact_table` saves a draft and publishes it in one step, so an",
    "apply is live as soon as the registry cache turns over.",
    "",
    "`dataversecontact_permissions_sync` must stay in the config. It publishes the",
    "scope's `defaults.json`, and a scope with no published defaults grants nothing",
    "— every route answers `403 Missing required permission`, reads included.",
    "",
  ].join("\n");
}

// Starter config for a scope that does not exist yet. The contact route is a
// working example, not a placeholder: every portal needs one, and "me" scoping
// on a contact is the join every other route is modelled on.
function starterMainTf() {
  return [
    "terraform {",
    "  required_providers {",
    "    dataversecontact = {",
    '      source  = "TrueNorthIT/dataversecontact"',
    '      version = "~> 1.0"',
    "    }",
    "  }",
    "}",
    "",
    "# Auth is the pre-shared admin connection key, sent as the admin Bearer token.",
    "# The same value must be set as ADMIN_CONNECTION_KEY on the Contact API.",
    'provider "dataversecontact" {',
    "  api_url        = var.api_url",
    "  connection_key = var.connection_key",
    "}",
    "",
    "# ── contact ────────────────────────────────────────────────────────────",
    "# me   = the signed-in user's own contact record",
    "# team = every contact at the same account (colleagues)",
    'resource "dataversecontact_table" "contact" {',
    "  scope                  = var.scope",
    '  route_name             = "contact"',
    '  description            = "The signed-in user\'s own profile"',
    '  dataverse_table        = "contacts"',
    '  dataverse_logical_name = "contact"',
    '  primary_key            = "contactid"',
    '  required_permission    = "contact"',
    '  filters                = ["statecode eq 0"]',
    "",
    "  default_select = [",
    '    "contactid", "fullname", "firstname", "lastname", "emailaddress1",',
    '    "telephone1", "mobilephone", "createdon", "modifiedon",',
    "  ]",
    "",
    '  lookup_fields          = ["fullname", "emailaddress1"]',
    '  lookup_search_contains = ["fullname", "emailaddress1"]',
    "",
    "  # me: the contact is itself",
    "  contact_join_step {",
    '    table = "contacts"',
    '    from  = "contactid"',
    '    key   = "contactid"',
    "  }",
    "",
    "  # team: contact → its parent account",
    "  team_join_step {",
    '    table = "accounts"',
    '    from  = "parentcustomerid_account"',
    '    key   = "accountid"',
    "  }",
    "",
    "  fields = {",
    '    contactid     = { type = "string", description = "Unique contact identifier", read_only = true }',
    '    fullname      = { type = "string", description = "Full name", read_only = true }',
    '    firstname     = { type = "string", description = "First name" }',
    '    lastname      = { type = "string", description = "Last name" }',
    '    emailaddress1 = { type = "string", description = "Primary email address" }',
    '    telephone1    = { type = "string", description = "Business phone" }',
    '    mobilephone   = { type = "string", description = "Mobile phone" }',
    '    createdon     = { type = "datetime", description = "Date created", read_only = true }',
    '    modifiedon    = { type = "datetime", description = "Date last modified", read_only = true }',
    "  }",
    "",
    "  # A polymorphic navigation property (parentcustomerid_account) is used in",
    "  # team_join_step and expand, but must NOT be declared as a field — the API",
    "  # drops it, which surfaces as a provider state-consistency error.",
    "}",
    "",
    "# Add a route per Dataverse table the portal needs. Discover the columns with:",
    "#   contact-admin discover entity <logicalName> --url $API_URL --scope $SCOPE --json",
    "",
    "# ── Permissions ────────────────────────────────────────────────────────",
    "# Required. A scope with no published defaults.json grants nothing — every",
    "# route answers 403, reads included.",
    'resource "dataversecontact_permissions_sync" "scope" {',
    "  scope = var.scope",
    "",
    "  # Let a signed-in user with no contact yet self-provision one via",
    "  # POST /me/register. Leave false for a scope where staff link accounts.",
    "  allow_self_register = false",
    "",
    "  default_permissions = {",
    '    contact = ["me", "write"]',
    "  }",
    "",
    "  triggers = {",
    '    routes_hash = sha256(join(",", [',
    "      dataversecontact_table.contact.id,",
    "    ]))",
    "  }",
    "",
    "  depends_on = [",
    "    dataversecontact_table.contact,",
    "  ]",
    "}",
    "",
  ].join("\n");
}

/* ── main ────────────────────────────────────────────────────────────── */

if (isNew) {
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !args.force) {
    die(`${outDir} already exists and is not empty. Pass --force to overwrite.`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "main.tf"), starterMainTf(), "utf8");
  writeFileSync(join(outDir, "variables.tf"), variablesTf(), "utf8");
  writeFileSync(join(outDir, "outputs.tf"), outputsTf(["dataversecontact_table.contact"]), "utf8");
  writeFileSync(join(outDir, "run.sh"), runSh(), "utf8");
  writeFileSync(join(outDir, ".env.example"), envExample(), "utf8");
  writeFileSync(join(outDir, ".gitignore"), gitignore(), "utf8");
  writeFileSync(join(outDir, "README.md"), readme(1, 0), "utf8");
  try {
    const { spawnSync } = await import("node:child_process");
    spawnSync("terraform", ["fmt", outDir], { stdio: "ignore" });
  } catch {
    /* terraform not installed */
  }
  console.log(`Scaffolded a new scope "${scope}" -> ${outDir}`);
  console.log("");
  console.log("Next:");
  console.log(`  cd ${outDir} && cp .env.example .env   # add the connection key`);
  console.log("  # add a route per table, then:");
  console.log("  bash run.sh plan");
  process.exit(0);
}

const [tablesResp, apisResp, defaultsResp] = await Promise.all([
  adminGet(`${scope}/table-definitions`),
  adminGet(`${scope}/custom-api-definitions`).catch(() => ({ definitions: [] })),
  adminGet(`${scope}/table-manager/defaults`),
]);

const storedDefaults = defaultsResp.defaults ?? {};
const storedPerms = storedDefaults.permissions ?? {};

const allTables = tablesResp.definitions ?? [];
const tables = allTables.filter((d) => d.source === "published");
const builtIn = allTables.filter((d) => d.source !== "published");

const allApis = apisResp.definitions ?? [];
const apis = allApis.filter((d) => d.source === "published");

if (tables.length === 0 && apis.length === 0) {
  die(`Scope "${scope}" has no published routes to export.`);
}

if (existsSync(outDir) && readdirSync(outDir).length > 0 && !args.force) {
  die(`${outDir} already exists and is not empty. Pass --force to overwrite.`);
}
mkdirSync(outDir, { recursive: true });

const tableRefs = [];
const apiRefs = [];
const imports = [];
const blocks = [];

// Scope summary — the things a reviewer should see before reading 900 lines.
const publicRoutes = tables.filter((d) => d.publicRead || d.publicCreate);
const broadRoutes = Object.entries(storedPerms)
  .filter(([, actions]) => actions.some((a) => a === "all" || a.endsWith(":all")))
  .map(([route]) => route);

blocks.push(
  [
    `# ${scope} — Dataverse Contact API scope`,
    "#",
    `# ${tables.length} route(s)` +
      (apis.length ? `, ${apis.length} custom API(s)` : "") +
      ` on ${apiUrl}.`,
    `# Self-registration: ${storedDefaults.allowSelfRegister ? "enabled" : "disabled"}` +
      (storedDefaults.join
        ? ` (join by ${storedDefaults.join.strategy}` +
          (storedDefaults.join.requireMatch ? ", match required)" : ")")
        : "") +
      ".",
    ...(publicRoutes.length
      ? [`# Public tier: ${publicRoutes.map((d) => d.routeName).join(", ")}.`]
      : []),
    ...(broadRoutes.length
      ? [`# Unscoped ("all") grants: ${broadRoutes.join(", ")} — every caller sees every row.`]
      : []),
    "#",
    "# Each route below carries a header comment: the Dataverse table it fronts,",
    "# how its rows join back to the caller, and what the baseline grant allows.",
    "",
    "terraform {",
    "  required_providers {",
    "    dataversecontact = {",
    '      source  = "TrueNorthIT/dataversecontact"',
    '      version = "~> 1.0"',
    "    }",
    "  }",
    "}",
    "",
    "# Auth is the pre-shared admin connection key, sent as the admin Bearer token.",
    "# The same value must be set as ADMIN_CONNECTION_KEY on the Contact API.",
    'provider "dataversecontact" {',
    "  api_url        = var.api_url",
    "  connection_key = var.connection_key",
    "}",
  ].join("\n"),
);

for (const def of tables) {
  const label = tfLabel(def.routeName);
  blocks.push(emitTable(def, label, storedPerms));
  tableRefs.push(`dataversecontact_table.${label}`);
  imports.push([`dataversecontact_table.${label}`, def.routeName]);
}

if (apis.length) {
  mkdirSync(join(outDir, "schemas"), { recursive: true });
  for (const def of apis) {
    const label = tfLabel(def.routeName);
    const fileName = `${def.dataverseUniqueName || def.routeName}.customapi.json`;
    // Take the schema from the per-route endpoint, not the definitions listing:
    // the listing is the *resolved* view (derived apiType, explicit nulls),
    // while schema_json has to match the published bytes or every plan drifts.
    const stored = await adminGet(`${scope}/custom-api-manager/${def.routeName}`);
    writeFileSync(
      join(outDir, "schemas", fileName),
      `${JSON.stringify(stored.schema ?? def, null, 2)}\n`,
      "utf8",
    );
    blocks.push(
      [
        `resource "dataversecontact_custom_api" "${label}" {`,
        "  scope       = var.scope",
        `  route_name  = ${hclString(def.routeName)}`,
        `  schema_json = file("\${path.module}/schemas/${fileName}")`,
        "}",
      ].join("\n"),
    );
    apiRefs.push(`dataversecontact_custom_api.${label}`);
    imports.push([`dataversecontact_custom_api.${label}`, def.routeName]);
  }
}

if (Object.keys(storedPerms).length === 0) {
  console.warn(
    `WARNING: scope "${scope}" has no stored defaults.json. The generated ` +
      "permissions_sync block has an empty permission map — fill it in before " +
      "applying, or every route will answer 403.",
  );
}
blocks.push(emitPermissionsSync(storedDefaults, tableRefs, apiRefs));

writeFileSync(join(outDir, "main.tf"), `${blocks.join("\n\n")}\n`, "utf8");
writeFileSync(join(outDir, "variables.tf"), variablesTf(), "utf8");
writeFileSync(join(outDir, "outputs.tf"), outputsTf(tableRefs), "utf8");
writeFileSync(join(outDir, "run.sh"), runSh(), "utf8");
writeFileSync(join(outDir, "import.sh"), importSh(imports), "utf8");
writeFileSync(join(outDir, ".env.example"), envExample(), "utf8");
writeFileSync(join(outDir, ".gitignore"), gitignore(), "utf8");
writeFileSync(join(outDir, "README.md"), readme(tables.length, apis.length), "utf8");

// Canonical formatting, if the CLI is on PATH — the emitter does not try to
// reproduce terraform fmt's alignment rules.
try {
  const { spawnSync } = await import("node:child_process");
  spawnSync("terraform", ["fmt", outDir], { stdio: "ignore" });
} catch {
  /* terraform not installed — the config is valid, just unaligned */
}

console.log(`Exported scope "${scope}" from ${apiUrl}`);
console.log(`  ${tables.length} table(s), ${apis.length} custom API(s) -> ${outDir}`);
if (builtIn.length) {
  console.log(
    `  skipped ${builtIn.length} built-in route(s) — not blob-managed, so not ` +
      `Terraform's to own: ${builtIn.map((d) => d.routeName).join(", ")}`,
  );
}
console.log("");
console.log("Next:");
console.log(`  cd ${outDir} && cp .env.example .env   # add the connection key`);
console.log("  terraform fmt && bash import.sh && bash run.sh plan");
