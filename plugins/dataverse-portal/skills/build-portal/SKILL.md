---
name: build-portal
description: Scaffold a new React + TypeScript + Tailwind + Auth0 SPA that consumes the Dataverse Contact API, end-to-end from a single prompt. Use when the user asks to build, scaffold, or create a portal / UI / app / frontend against a Dataverse table — e.g. "build me a case portal", "build me a case portal using https://api.dataverse-contact.tnapps.co.uk", "scaffold a UI for the booking table in scope pilot", "create a contacts app". The skill authenticates via the @truenorth-it/contact-admin CLI — no MCP registration needed.
---

# build-portal

End-to-end scaffold of a Vite + React + TypeScript + Tailwind + Auth0 SPA against the Dataverse Contact API. The skill handles everything — API discovery, authentication, scope provisioning if requested, table scaffolding, and the final frontend.

## Prerequisites

This skill requires the `@truenorth-it/contact-admin` CLI. If not already installed globally, install it at the start:

```bash
npm install -g @truenorth-it/contact-admin
```

All admin operations use this CLI instead of MCP. No MCP registration is needed.

## Trigger-time data from the prompt

| Signal | How to detect | How to use |
|---|---|---|
| API URL | Any `https://…` URL in the prompt whose host looks like an API endpoint | `API_URL` — the base for all HTTP + MCP endpoints |
| Scope | "in scope X" / "scope=X" / "use scope X" | `TARGET_SCOPE` — URL scope + provisioning target |
| Access tier | "me" / "team" / "all" | `TIER` |
| Target table | "case portal" → `incident`; "booking" → `msdyn_bookableresourcebooking`; etc. | Drives setup-table calls |
| Project name | Repeats the portal noun (`case-portal`, `bookings-pilot`) or explicit "project X" | Folder name + Vite project name |

Defaults when absent:

| Default | Value |
|---|---|
| `API_URL` | `https://api.dataverse-contact.tnapps.co.uk` |
| `TARGET_SCOPE` | **asked** — see step 0. Don't silently default to `default` — the user gets a one-question choice between `default` and a sensibly-named new scope. |
| `TIER` | `me` |
| Project name | slugified portal noun |

For the URL, tier, and project name: state what you assumed in one sentence before work starts — don't interrogate. Only the scope question is interactive.

## Version check

**Expected plugin version: 0.8.0**

Before doing any work, verify the installed plugin version. Read the plugin manifest at `../../.claude-plugin/plugin.json` (relative to this skill file) using the Read tool:

- If the `version` field matches `0.8.0` — proceed.
- If the `version` field is **older** — tell the user: "Your dataverse-portal plugin is v`<installed>` but this skill expects v0.8.0. Run `/plugin marketplace update truenorthit` and then `/reload-plugins` to get the latest version." Then stop.
- If the file cannot be read — warn the user but proceed.

## Workflow

All admin operations use the `contact-admin` CLI with `--json` for structured output. The global flags `--url` and `--scope` are passed to every command. For brevity the examples below assume `API_URL` and `TARGET_SCOPE` are set as shell variables.

### 0. Discover the deployment and resolve the scope

Two parallel calls (both public, no auth):

```bash
# Auth0 config for the portal's .env
WELL_KNOWN=$(curl -s "${API_URL}/.well-known/oauth-protected-resource")
AUTH0_DOMAIN=$(echo "$WELL_KNOWN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).auth0_domain||''))")
AUTH0_AUDIENCE_DEFAULT=$(echo "$WELL_KNOWN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).auth0_audience||''))")
```

```bash
# Existing scopes
contact-admin scopes list --url "${API_URL}" --json
```

Field map from `.well-known`:

| JSON field | Goes into portal `.env` as |
|---|---|
| `auth0_domain` | `VITE_AUTH0_DOMAIN` |
| `auth0_audience` | `VITE_AUTH0_AUDIENCE` (default scope) |
| `resource` / `auth0_audience` | base audience — append `/<scope>` for non-default scopes |

Cache these for step 7.

**Resolve `TARGET_SCOPE` now — before step 1.** Authentication needs the scope.

If the user named a scope in the prompt (e.g. "in scope case-portal"), use it. Otherwise, use the existing scopes to guide the choice:

- If the portal noun maps to an **existing** scope (e.g. "case portal" and `case-portal` is in the list), use it — no need to ask.
- If only `default` exists, ask whether to use it or create a new one.
- If multiple scopes exist, show the list and ask which to use (or create new).

Ask in ONE sentence, e.g.:
> "This API has scopes: `default`, `case-portal`. Use one of those, or create a new scope? (e.g. `bookings-pilot`)"

Wait for their reply, then use their choice as `TARGET_SCOPE` for everything that follows. **Do not proceed to step 1 until `TARGET_SCOPE` is decided.**

### 1. Authenticate

```bash
contact-admin login --url "${API_URL}" --scope "${TARGET_SCOPE}"
```

This runs the device-code OAuth flow. It prints a URL for the user to approve in their browser, polls automatically, and stores the key locally in `~/.contact-admin/keys.json`. If the scope doesn't exist yet, it is auto-created when the user approves.

Print the verification URL to the user:

> **Open this URL to authorise:**
> `<URL from CLI output>`
> Polling automatically — just approve in the browser and I'll continue.

**Do NOT stop or wait for the user to come back.** The CLI polls unattended. Once it prints "Logged in", proceed immediately.

If the CLI reports the user is already logged in for this URL + scope (key exists and hasn't expired), skip straight to step 2.

### 2. Orient

```bash
contact-admin whoami --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

Check:
- `capabilities.canAdminCurrentScope` — required. If false, stop.
- `currentScope` — confirms the scope matches your target.

### 3. Create scope if needed

If the target scope didn't exist and wasn't auto-created during login (e.g. user logged in with an existing key for a different scope), create it:

```bash
contact-admin scopes create "${TARGET_SCOPE}" --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

If the scope already exists, skip this step.

### 4. Populate tables

First, check what's already published:

```bash
contact-admin tables list --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

For each table the portal needs (derived from the prompt — "case portal" → `incident` + `annotation` for notes; "booking portal" → `msdyn_bookableresourcebooking`; etc.), if NOT already published, run:

```bash
contact-admin setup-table <entity> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

This single command discovers the entity from Dataverse, scaffolds the schema, saves the draft, and publishes — all in one step.

**Join-ambiguity handling:** `setup-table` auto-publishes without pausing. If the scaffold response includes ambiguous join paths (multiple contact or account lookups), the CLI output will include `joinAnalysis` with hints. When `--json` is used, check the response for `joinAnalysis.contactJoinAmbiguous` or `joinAnalysis.accountJoinAmbiguous`. If either is `true`:

1. Run `contact-admin tables sample-data <entity> --top 3 --json` to inspect the chosen join's lookup values.
2. **Pause and ask the user** in one sentence, e.g.:
   > "On `incident` I found two contact joins: `customerid → contact` and `ownerid → contact`. The scaffold picked `customerid`. Sample rows show `customerid` = [Alice, Bob, (null)]. Confirm, or say which to use."
3. If the user picks a different join, use the granular commands instead:
   ```bash
   contact-admin tables scaffold <entity> --json   # get the schema
   # modify schema.contactJoinPath / schema.teamJoinPath
   contact-admin tables save-draft <routeName> --schema '<modified-json>'
   contact-admin tables publish --tables <routeName>
   ```

If neither flag is set (exactly one direct join each side), don't ask — just proceed.

**Empty-table case:** if `sample-data` returns `count: 0`, don't block. Tell the user: "No rows in `<entity>` yet — join was chosen from metadata only; double-check once real data lands."

Skip tables that are already published.

### 5. Inspect published schema

For each target table:

```bash
# Full schema with fields/types/expands
contact-admin tables get <routeName> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json

# Picklist values (public, no auth)
curl -s "${API_URL}/api/v2/${TARGET_SCOPE}/choices/<routeName>"
```

Cache these for TypeScript type generation and SDK `select` lists.

### 6. Scaffold the frontend

From the user's cwd:

```bash
PROJECT_NAME=<inferred or from prompt>
npm create vite@latest "$PROJECT_NAME" -- --template react-ts
cd "$PROJECT_NAME"
npm install
npm install @auth0/auth0-react @truenorth-it/dataverse-client
npm install -D tailwindcss @tailwindcss/vite
```

Mirror the layout of `dataverse-example-case-portal` — either local sibling dir or `WebFetch` from `https://raw.githubusercontent.com/TrueNorthIT/dataverse-example-case-portal/main/...`:

```
src/
├── App.tsx                  ← Auth0 gate + layout
├── main.tsx                 ← Auth0Provider wrapper
├── env.ts                   ← requireEnvVar() for four VITE_* vars
├── index.css                ← Tailwind @import
├── services/<table>Api.ts   ← SDK-based (fetchX, createX, updateX)
├── hooks/use<Table>.ts      ← React hook for data + state
├── types/<table>.ts         ← types derived from tables get
└── components/*.tsx         ← LoginScreen, Header, <Table>Table, <Table>Detail
```

Non-negotiable rules:

- Files under 300 lines. Split components; extract hooks.
- One concern per file.
- No barrel exports.
- **Always use the `@truenorth-it/dataverse-client` SDK. Never hand-roll fetch, never build OData query strings, never set the `Authorization` header yourself.** The SDK's scope clients (`client.me`, `client.team`, `client.all`) handle auth, query encoding, pagination, and error shapes.
- Generated types come from `tables get`, never guesses.

### SDK usage — the only acceptable pattern

```ts
// src/lib/client.ts — one-time setup
import { createClient } from "@truenorth-it/dataverse-client";
import { useAuth0 } from "@auth0/auth0-react";

export function useDataverseClient() {
  const { getAccessTokenSilently } = useAuth0();
  return createClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL,
    getToken: () => getAccessTokenSilently(),
  });
}

// src/services/caseApi.ts — read
import type { DataverseClient } from "@truenorth-it/dataverse-client";
import type { Case } from "../types/case";

export async function fetchCases(client: DataverseClient) {
  return client.me.list<Case>("case", {
    select: ["incidentid", "ticketnumber", "title", "statuscode"],
    orderBy: "modifiedon:desc",
    top: 100,
  });
}

export async function fetchCase(client: DataverseClient, id: string) {
  return client.me.get<Case>("case", id);
}

// src/services/caseApi.ts — write
export async function createCase(client: DataverseClient, input: Partial<Case>) {
  return client.me.create("case", input);
}

export async function updateCase(
  client: DataverseClient,
  id: string,
  patch: Partial<Case>,
) {
  return client.me.update("case", id, patch);
}
```

Tier selection follows the user's `TIER` from the prompt:
- `me` → `client.me.list/get/create/update` — caller's records only (needs `contactJoinPath`)
- `team` → `client.team.*` — account-linked records (needs `teamJoinPath`)
- `all` → `client.all.*` — admin-tier, unfiltered

For picklist labels, the SDK automatically includes `<field>_label` alongside `<field>` in list responses when the schema declares the field as `choice`. Use those fields directly in the UI — no extra lookup needed.

For filters:
```ts
// Single-field filter
const active = await client.me.list<Case>("case", {
  filter: { field: "statuscode", operator: "eq", value: 1 },
});

// Composite filter
const urgent = await client.me.list<Case>("case", {
  filter: { and: [
    { field: "prioritycode", operator: "eq", value: 1 },
    { field: "statecode", operator: "eq", value: 0 },
  ]},
});
```

Never construct OData strings by hand. The SDK builds `$filter` from the structured object.

### 7. Environment — including Auth0 SPA auto-creation

Provision the Auth0 SPA app so the user never touches the Auth0 dashboard:

```bash
contact-admin auth0 create-spa "${PROJECT_NAME}" --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

The response includes `clientId`. Write `.env.example` and `.env` with **every value filled in**:

```
VITE_AUTH0_DOMAIN=${AUTH0_DOMAIN}
VITE_AUTH0_CLIENT_ID=<clientId from create-spa>
VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE_DEFAULT}         # for default scope
# or for a named scope:
VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE_DEFAULT}/${TARGET_SCOPE}
VITE_API_BASE_URL=${API_URL}
```

No hardcoded tenant names, no blank Client ID, no "go copy-paste from Auth0". Everything comes from `/.well-known/oauth-protected-resource` + the `create-spa` response.

**Production URL (optional):** if the user specifies a prod URL (e.g. "deploy to vercel" later), pass `--extra-urls https://<prod>.vercel.app` to `auth0 create-spa` so the Auth0 app is pre-registered for that origin too.

### 8. Run & verify

```bash
npm run typecheck   # must pass clean
npm run dev &       # background, report URL
```

### 9. Offer to grant the first user access

After confirming the scaffold, ask the user in one sentence whether to add a user now:

> Auth0 SPA app `<project-name>` created (client_id: `<short-prefix>...`) with localhost:5173 pre-authorised. Reload `http://localhost:5173` when ready.
>
> **Want me to grant access to a user right now?** Give me an email and I'll grant a sensible starter permission set — they'll be able to log in immediately. (Or skip this, and do it in the Auth0 dashboard later.)

If the user says yes with an email:

1. Compute the starter permission set from the scope's tables. For a new scope you just populated, this is typically the `me`-tier read/write/create perms for every table:
   - `<table>` (read my records)
   - `<table>:write` (update my records)
   - `<table>:create` (create records auto-bound to me)
   - `<table>:lookup` (resolve lookups)
   - Repeat for related tables (e.g. `annotation` for case portals)
2. Grant the permissions:
   ```bash
   contact-admin auth0 grant-access "<email>" \
     --permissions "<table>,<table>:write,<table>:create,<table>:lookup" \
     --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
   ```
3. Relay the response:
   > Granted 6 permissions to steve@drakey.co.uk on scope `case-portal`.
   > They need to log out / log back in before the new token picks up the perms. If they already minted an MCP key, tell them to regenerate — keys snapshot perms at issuance.

If the user wants team-tier or admin-tier access, expand the list accordingly (e.g. add `<table>:team` + `<table>:write:team`, or `<table>:all` + `<table>:write:all`).

If `grant-access` returns `found: false`, the user doesn't have an Auth0 account yet — tell the caller to invite them via the Auth0 dashboard (Users → Create User) and re-run.

## Worked examples

### "build me a case portal using https://api.dataverse-contact.tnapps.co.uk"

- `API_URL` = provided; `TARGET_SCOPE` not specified.
- `contact-admin scopes list` returns: default, case-portal, ...
- Skill asks: "This API has scopes: default, case-portal. Use one of those, or create a new scope?"
- User: "default".
- `contact-admin login --scope default` — stores key.
- `contact-admin tables list` finds existing `incident` + `annotation` — no setup-table needed.
- Scaffolds frontend. One prompt, one browser click, done.

### "build me a bookings portal"

- `API_URL` = default; no scope in prompt.
- `contact-admin scopes list` returns: default.
- Skill asks: "Put this in `default` or create a new scope `bookings`?"
- User: "new scope called `bookings-pilot`".
- `contact-admin login --scope bookings-pilot` — scope auto-created on approval.
- `contact-admin setup-table msdyn_bookableresourcebooking` — scaffolds, saves, publishes.
- Scaffolds portal targeting `/api/v2/bookings-pilot/` with audience `https://tn-dataverse-contact-api/bookings-pilot`.

### "build me a case portal in scope case-portal"

- Scope explicitly named.
- `contact-admin login --scope case-portal` — scope auto-created on approval if it doesn't exist.
- `contact-admin setup-table incident` + `contact-admin setup-table annotation` — populates tables.
- Scaffolds frontend.

### Ambiguous contact join — confirmation flow

- User: "build me a portal for the `tn_project` table in scope `pm`".
- Skill hits step 4.2: `scaffold_table({ entity: "tn_project" })` returns `joinAnalysis.contactJoinAmbiguous: true` because the entity has `ownerid → contact` and `tn_projectleadid → contact`.
- Step 4.3: `sample_data({ entity: "tn_projects", top: 3 })` returns 3 rows. Skill pulls out the `tn_projectleadid` values (the scaffolder's pick) — they look populated.
- Step 4.4: skill asks in one sentence: "I found two contact joins on `tn_project`: `tn_projectleadid → contact` and `ownerid → contact`. I'm picking `tn_projectleadid`. Sample rows show `tn_projectleadid` = [Sam, Jo, Priya]. Confirm, or say which to use."
- User: "use ownerid". Skill mutates `schema.contactJoinPath` to the `ownerid` candidate's path, then proceeds to `save_table_draft` + `publish_tables`.

### Brand-new empty table

- User: "build me a portal for `tn_expense` in scope `expenses`".
- Steps 4.1 + 4.2 run normally; `joinAnalysis.contactJoinAmbiguous: false` (only one direct lookup).
- Step 4.3: `sample_data` returns `count: 0`. Skill prints: "No rows in `tn_expense` yet — skipping data-level join verification. The join was chosen from metadata only; double-check once real data lands."
- Step 4.4 fast-path: "Using `tn_contactid` → contact (metadata only — empty table)." Continues without asking.

## Dependencies

This skill shells out via `Bash` for:
- `contact-admin` — all admin operations (auth, scopes, tables, Auth0)
- `curl` — `/.well-known` discovery + choices endpoint
- `node -e` — JSON extraction from curl responses (portable; works on Git Bash, macOS, Linux)
- `npm` / `npx` — scaffold and type-check

**Never use `jq`.** It isn't installed on Windows Git Bash or many corporate envs, and missing-command failures in mid-flow break the skill silently. Always reach for `node -e` when you need to parse JSON from a curl response.

The plugin's `.claude/settings.json` pre-approves these so the skill doesn't pause for permissions mid-flow.
