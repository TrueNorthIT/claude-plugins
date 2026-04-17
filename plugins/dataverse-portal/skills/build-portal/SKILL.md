---
name: build-portal
description: Scaffold a new React + TypeScript + Tailwind + Auth0 SPA that consumes the Dataverse Contact API (api.dataverse-contact.tnapps.co.uk), and optionally provision a new scope for it. Use when the user asks to build, scaffold, or create a portal / UI / app / frontend against a Dataverse table — e.g. "build me a case portal", "scaffold a UI for the booking table", "create a contacts app using the dataverse api", "build me a case portal in scope case-portal". Follows the conventions proven in dataverse-example-case-portal.
---

# build-portal

Scaffolds a new SPA that consumes the Dataverse Contact API. Optionally provisions a new scope if the URL-bound scope doesn't exist yet. Mirrors the layout and patterns of the canonical reference (`dataverse-example-case-portal`).

## Defaults (assume unless user overrides)

| Setting | Default | User override |
|---|---|---|
| API base URL | `https://api.dataverse-contact.tnapps.co.uk` | "my API is at X" |
| Scope | URL-bound scope from the registered admin MCP (the `dataverse-<scope>` client) | "use scope X" or "in scope X" |
| Access tier | `me` | "team" or "all" |
| Stack | Vite + React 19 + TypeScript + Tailwind v4 + `@auth0/auth0-react` | rarely overridden |
| SDK | `@truenorth-it/dataverse-client` (use it — don't hand-roll fetch) | — |
| Target tables | inferred from the prompt ("case" → `incident`, "booking" → `msdyn_bookableresourcebooking`, etc.) | explicit table names |

When you apply defaults, state them in one sentence before scaffolding — don't interrogate the user first.

## Prerequisite: the admin MCP

This skill depends on the `dataverse-<scope>` admin MCP (from `/api/v2/{scope}/mcp-admin`), registered via the Claude Code quickstart page at `/claude-code`. Expected tools:

- `whoami` — check caller identity + capabilities (canAdminTables, canCreateScopes)
- `list_scopes` — see which scopes already exist
- `create_scope` — provision a new scope (requires `scope:admin`)
- `list_table_definitions`, `get_table_definition` — schema introspection for existing tables
- `scaffold_table`, `save_table_draft`, `publish_tables` — table management for new scopes
- `discover_entities`, `discover_entity_details` — Dataverse entity discovery

If the MCP is not available, stop and point the user at `/claude-code`. Don't guess schemas.

## Workflow

### 1. Orient — call `whoami`

Read back:
- `currentScope` — the URL-bound scope from the MCP registration
- `capabilities.canAdminTables` — needed for all scaffolding
- `capabilities.canCreateScopes` — needed only for creating a new scope

If `canAdminTables` is false, stop: "You don't have `admin:tables` on the admin audience. Ask an admin to grant it via Auth0." No further work is possible.

### 2. Resolve the scope

Call `list_scopes`. Three branches:

**A. No scope mentioned in the prompt OR currentScope is `default`:**
Use `default`. Proceed to step 4.

**B. Scope named and already in `list_scopes`:**
Use it. Proceed to step 4.

**C. Scope named (or URL-bound) and NOT in `list_scopes`:**
Fork on `canCreateScopes`:
- If false, stop: "Scope `X` doesn't exist and you can't create one. Ask an admin for `scope:admin` or pick an existing scope."
- If true, confirm with the user in one sentence: "Creating scope `X` via the admin MCP — this provisions a new Auth0 Resource Server at `{default-audience}/X`." Then call `create_scope({ name: "X" })` (or `create_scope()` if the URL scope matches). No MCP key regeneration is needed — `admin:tables` is flat.

### 3. Populate the scope with tables (only for newly created scopes)

For each table the portal needs (derived from the prompt — e.g. "case portal" → `incident`, "casenotes" for the annotation sub-flow):

1. `discover_entity_details({ entity: "<logicalName>" })` — raw Dataverse metadata
2. `scaffold_table({ entity: "<logicalName>" })` — generate a SchemaHint draft
3. `save_table_draft({ schema: <json> })` — persist as a draft (validates against live Dataverse)
4. `publish_tables({ tables: ["<routeName>"] })` — publish; auto-syncs Auth0 permissions

For `default` or already-populated scopes, skip this step.

### 4. Inspect published schema

For each target table:
- `get_table_definition({ table: "<routeName>" })` — canonical schema with fields/types/expands
- Public HTTP: `GET /api/v2/<scope>/choices/<table>` — choice/picklist values (no auth)
- Optionally: `sample_data({ table: "<routeName>", limit: 3 })` — real rows to sanity-check field presence

Cache these — you'll use them for TypeScript types and `select` field lists.

### 5. Scaffold the frontend

Run from the cwd the user invoked you in. If it's already populated, ask before overwriting.

```bash
npm create vite@latest <name> -- --template react-ts
cd <name>
npm install
npm install @auth0/auth0-react @truenorth-it/dataverse-client
npm install -D tailwindcss @tailwindcss/vite
```

Mirror this layout (from `dataverse-example-case-portal/`):

```
src/
├── App.tsx              ← Auth0 gate + layout
├── main.tsx             ← Auth0Provider wrapper
├── env.ts               ← requireEnvVar() for the four VITE_* vars
├── index.css            ← Tailwind @import
├── services/<table>Api.ts   ← SDK-based (fetchX, createX, updateX)
├── hooks/use<Table>.ts      ← React hook for data + state
├── types/<table>.ts         ← types derived from get_table_definition
├── components/
│   ├── LoginScreen.tsx
│   ├── Header.tsx
│   ├── <Table>Table.tsx
│   └── <Table>Detail.tsx
└── utils/
    ├── format.ts
    └── style.ts
```

Non-negotiable rules:
- Files **under 300 lines**. Split components, extract hooks.
- One concern per file. Types in `types/`, helpers in `utils/`, hooks in `hooks/`, services in `services/`.
- No barrel exports. Import directly from the defining file.
- No code shared with the API repo — all data via HTTP through the SDK.
- Use the SDK's scope clients: `client.me.list<T>("case", { select, top, orderBy })`. Don't hand-roll fetch.
- Generated TypeScript types come from `get_table_definition`, not guesses.

### 6. Environment

Write `.env.example`:

```
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=            # create a new Auth0 SPA app for this portal
VITE_AUTH0_AUDIENCE=<scope-audience>    # from whoami/list_scopes for the target scope
VITE_API_BASE_URL=https://api.dataverse-contact.tnapps.co.uk
```

Copy to `.env`, filling in everything except `VITE_AUTH0_CLIENT_ID`. For the default scope, audience is `https://tn-dataverse-contact-api`. For custom scopes, it's `https://tn-dataverse-contact-api/<scope>`.

### 7. Run & verify

- `npm run typecheck` — must pass clean
- `npm run dev` in the background — report the URL
- Stop. Don't iterate further until the user has looked at it.

### 8. Post-scaffold instructions (print verbatim)

> **One-time Auth0 setup for this portal:**
> 1. In Auth0, create a new **SPA Application** (same tenant as the API).
> 2. Copy the Client ID into `.env` as `VITE_AUTH0_CLIENT_ID`.
> 3. In Settings, add `http://localhost:5173` to **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**.
> 4. Reload `http://localhost:5173` and log in.

## Copy-from-reference cheat sheet

If `../dataverse-example-case-portal/` exists locally, read it. Otherwise `WebFetch` the file from GitHub:

| Generating | Copy pattern from | GitHub fallback |
|---|---|---|
| `src/env.ts` | `dataverse-example-case-portal/src/env.ts` (verbatim) | `https://raw.githubusercontent.com/TrueNorthIT/dataverse-example-case-portal/main/src/env.ts` |
| `src/main.tsx` | `dataverse-example-case-portal/src/main.tsx` | same path |
| `src/App.tsx` | `dataverse-example-case-portal/src/App.tsx` (auth gate structure) | same path |
| `src/services/<table>Api.ts` | `dataverse-example-case-portal/src/services/caseApi.ts` | same path |
| `src/hooks/use<Table>.ts` | `dataverse-example-case-portal/src/hooks/useCases.ts` | same path |
| Components | `dataverse-example-case-portal/src/components/*.tsx` | same path |
| `.env.example`, `vercel.json`, `vite.config.ts`, `tsconfig.json` | copy verbatim | same path |

Do not invent patterns that diverge from the reference. If the user asks for something the reference doesn't cover, ask before improvising.

## Deploy hint (only if user asks)

SPA on Vercel:

```bash
npm install -g vercel
vercel            # first deploy — answer prompts
vercel --prod     # subsequent
```

Then set the four `VITE_*` env vars in Vercel, and in Auth0 add the Vercel URL to **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**.

## Worked example — "build me a case portal in scope case-pilot"

1. `whoami` → `{ currentScope: "case-pilot", canAdminTables: true, canCreateScopes: true }`
2. `list_scopes` → `{ scopes: ["default", "rbooking"] }` — `case-pilot` missing
3. Confirm with user, call `create_scope()` (defaults to `case-pilot` from URL)
4. `discover_entity_details({ entity: "incident" })` → schema
5. `scaffold_table({ entity: "incident" })` → draft
6. `save_table_draft({ schema })` + `publish_tables({ tables: ["case"] })` — same for `annotation` → `casenotes`
7. `get_table_definition({ table: "case" })` — canonical fields
8. Public `GET /api/v2/case-pilot/choices/case` — picklists
9. `npm create vite@latest case-pilot ...` — scaffold
10. Write files following the reference, `.env` with audience `https://tn-dataverse-contact-api/case-pilot`
11. `npm run dev`, print the Auth0 SPA checklist
