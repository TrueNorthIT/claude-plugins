---
name: build-portal
description: Scaffold a new React + TypeScript + Tailwind + Auth0 SPA that consumes the Dataverse Contact API, end-to-end from a single prompt. Use when the user asks to build, scaffold, or create a portal / UI / app / frontend against a Dataverse table — e.g. "build me a case portal", "build me a case portal using https://api.dataverse-contact.tnapps.co.uk", "scaffold a UI for the booking table in scope pilot", "create a contacts app". The skill auto-registers the admin MCP via device-code OAuth if it's not already connected.
---

# build-portal

End-to-end scaffold of a Vite + React + TypeScript + Tailwind + Auth0 SPA against the Dataverse Contact API. The skill handles everything — API discovery, MCP registration via device-code OAuth, scope provisioning if requested, table scaffolding, and the final frontend.

## Trigger-time data from the prompt

| Signal | How to detect | How to use |
|---|---|---|
| API URL | Any `https://…` URL in the prompt whose host looks like an API endpoint | `API_URL` — the base for all HTTP + MCP endpoints |
| Scope | "in scope X" / "scope=X" / "use scope X" | `TARGET_SCOPE` — URL scope + provisioning target |
| Access tier | "me" / "team" / "all" | `TIER` |
| Target table | "case portal" → `incident`; "booking" → `msdyn_bookableresourcebooking`; etc. | Drives scaffold_table calls |
| Project name | Repeats the portal noun (`case-portal`, `bookings-pilot`) or explicit "project X" | Folder name + Vite project name |

Defaults when absent:

| Default | Value |
|---|---|
| `API_URL` | `https://api.dataverse-contact.tnapps.co.uk` |
| `TARGET_SCOPE` | `default` |
| `TIER` | `me` |
| Project name | slugified portal noun |

State the assumed defaults in one sentence before work starts. Don't interrogate.

## Workflow

### 0. Discover the deployment

Hit `GET ${API_URL}/.well-known/oauth-protected-resource` (public). The response has everything you need to populate the scaffolded portal's `.env` later — don't guess, don't ask the user.

```bash
WELL_KNOWN=$(curl -s "${API_URL}/.well-known/oauth-protected-resource")
AUTH0_DOMAIN=$(echo "$WELL_KNOWN" | jq -r .auth0_domain)
AUTH0_AUDIENCE_DEFAULT=$(echo "$WELL_KNOWN" | jq -r .auth0_audience)
```

Field map:

| JSON field | Goes into portal `.env` as |
|---|---|
| `auth0_domain` | `VITE_AUTH0_DOMAIN` |
| `auth0_audience` | `VITE_AUTH0_AUDIENCE` (default scope) |
| `resource` / `auth0_audience` | base audience — append `/<scope>` for non-default scopes |

Cache these for step 7.

### 1. Ensure the admin MCP is registered

```bash
claude mcp list
```

Look for an entry whose URL matches `${API_URL}/api/v2/${TARGET_SCOPE}/mcp-admin`. If present, skip to step 3.

If absent, run the device-code flow:

```bash
# a) Request codes
RESP=$(curl -s -X POST "${API_URL}/api/v2/device/code" \
  -H "Content-Type: application/json" \
  -d "{\"scope\":\"${TARGET_SCOPE}\",\"client_name\":\"claude-code\"}")

USER_CODE=$(echo "$RESP" | jq -r .user_code)
DEVICE_CODE=$(echo "$RESP" | jq -r .device_code)
VERIFY_URL=$(echo "$RESP" | jq -r .verification_uri_complete)
INTERVAL=$(echo "$RESP" | jq -r .interval)
```

Print to the user, verbatim:

> **Open this URL to authorize:**
> `<VERIFY_URL>`
> Code: `<USER_CODE>` (valid for 10 minutes)
> I'll wait here — come back when done.

Poll for the key every `INTERVAL` seconds (typically 3). The loop exits on 200 (success), 403 (denied), or 410 (expired):

```bash
while true; do
  POLL=$(curl -s -w '\nHTTP:%{http_code}' -X POST "${API_URL}/api/v2/device/token" \
    -H "Content-Type: application/json" \
    -d "{\"device_code\":\"${DEVICE_CODE}\"}")
  STATUS=$(echo "$POLL" | tail -n1 | sed 's/HTTP://')
  BODY=$(echo "$POLL" | head -n-1)
  case "$STATUS" in
    200) MCP_KEY=$(echo "$BODY" | jq -r .mcp_key); break ;;
    428) sleep "$INTERVAL" ;;
    403) echo "User denied"; exit 1 ;;
    410) echo "Code expired"; exit 1 ;;
    *)   echo "Unexpected $STATUS"; exit 1 ;;
  esac
done
```

Register the MCP:

```bash
claude mcp add --transport http "dataverse-${TARGET_SCOPE}" \
  "${API_URL}/api/v2/${TARGET_SCOPE}/mcp-admin" \
  -H "Authorization: Bearer ${MCP_KEY}"
```

The skill uses `Bash` for all of the above — no user typing required beyond visiting the verification URL once.

### 2. Orient — call `whoami` via the MCP

Read:
- `capabilities.canAdminTables` — required. If false, stop.
- `capabilities.canCreateScopes` — required only if `TARGET_SCOPE` is new.
- `currentScope` — confirms the URL-bound scope matches your target.

### 3. Resolve the scope

Call `list_scopes`. Three branches:

- **`TARGET_SCOPE` is `default` or already present** → proceed to step 4.
- **`TARGET_SCOPE` missing AND `canCreateScopes`** → call `create_scope()` (no args needed — defaults to URL scope). State that you're provisioning a new scope.
- **`TARGET_SCOPE` missing AND !canCreateScopes** → stop. Ask the user to request `scope:admin` or pick an existing scope.

### 4. Populate tables (only for newly created scopes)

For each table the portal needs (derived from the prompt — "case portal" → `incident` + `annotation` for notes; "booking portal" → `msdyn_bookableresourcebooking`; etc.):

1. `discover_entity_details({ entity })` — live Dataverse metadata
2. `scaffold_table({ entity })` — generate a SchemaHint draft
3. `save_table_draft({ schema: <json> })` — persist
4. `publish_tables({ tables: [<routeName>] })` — go live (auto-syncs Auth0 permissions)

For `default` or already-populated scopes, skip this step.

### 5. Inspect published schema

For each target table:
- `get_table_definition({ table: <routeName> })` — canonical schema with fields/types/expands
- Public HTTP: `GET ${API_URL}/api/v2/${TARGET_SCOPE}/choices/<table>` — picklist values (no auth)
- Optionally `sample_data({ table, limit: 3 })` — real rows for sanity

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
├── types/<table>.ts         ← types derived from get_table_definition
└── components/*.tsx         ← LoginScreen, Header, <Table>Table, <Table>Detail
```

Non-negotiable rules:

- Files under 300 lines. Split components; extract hooks.
- One concern per file.
- No barrel exports.
- **Always use the `@truenorth-it/dataverse-client` SDK. Never hand-roll fetch, never build OData query strings, never set the `Authorization` header yourself.** The SDK's scope clients (`client.me`, `client.team`, `client.all`) handle auth, query encoding, pagination, and error shapes.
- Generated types come from `get_table_definition`, never guesses.

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

### 7. Environment

Write `.env.example` and `.env` using values discovered in step 0:

```
VITE_AUTH0_DOMAIN=${AUTH0_DOMAIN}
VITE_AUTH0_CLIENT_ID=            # user supplies — see step 9
VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE_DEFAULT}         # for default scope
# or
VITE_AUTH0_AUDIENCE=${AUTH0_AUDIENCE_DEFAULT}/${TARGET_SCOPE}  # for a named scope
VITE_API_BASE_URL=${API_URL}
```

No guessing, no hardcoded tenant names — all values come from `/.well-known/oauth-protected-resource`.

### 8. Run & verify

```bash
npm run typecheck   # must pass clean
npm run dev &       # background, report URL
```

### 9. Print the Auth0 SPA checklist (verbatim)

> **One-time Auth0 setup:**
> 1. Create a new **Single Page Application** in Auth0 (same tenant).
> 2. Copy Client ID into `.env` as `VITE_AUTH0_CLIENT_ID`.
> 3. Add `http://localhost:5173` to Allowed Callback / Logout / Web Origin URLs.
> 4. Save and reload.

## Worked examples

### "build me a case portal using https://api.dataverse-contact.tnapps.co.uk"

- `API_URL` = provided
- `TARGET_SCOPE` = default
- Fetches `/.well-known`, checks `claude mcp list`, runs device flow if needed, confirms `canAdminTables`, uses existing `incident` + `annotation` tables, scaffolds portal. One prompt, one browser click to authorize.

### "build me a bookings portal in scope bookings-pilot"

- `API_URL` = default (skill's built-in)
- `TARGET_SCOPE` = `bookings-pilot`
- Device flow registers MCP at `/api/v2/bookings-pilot/mcp-admin`
- `whoami` → `canCreateScopes: true`
- `list_scopes` → missing
- `create_scope()` → provisions Auth0 resource server + blob marker
- `scaffold_table(msdyn_bookableresourcebooking)` + `save_table_draft` + `publish_tables`
- Scaffold portal targeting `/api/v2/bookings-pilot/` with audience `https://tn-dataverse-contact-api/bookings-pilot`

## Dependencies

This skill shells out via `Bash` for:
- `curl` — device flow + `/.well-known` + choices
- `claude mcp list` / `claude mcp add`
- `jq` — JSON extraction from curl responses
- `npm` / `npx` — scaffold and type-check

The plugin's `.claude/settings.json` pre-approves these so the skill doesn't pause for permissions mid-flow.
