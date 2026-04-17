---
name: build-portal
description: Scaffold a new React + TypeScript + Tailwind + Auth0 SPA that consumes the Dataverse Contact API (api.dataverse-contact.tnapps.co.uk). Use when the user asks to build, scaffold, or create a portal / UI / app / frontend against a Dataverse table — e.g. "build me a case portal", "scaffold a UI for the booking table", "create a contacts app using the dataverse API". Follows the conventions proven in dataverse-example-case-portal.
---

# build-portal

Scaffolds a new SPA that consumes the Dataverse Contact API, mirroring the layout and patterns of the canonical reference (`dataverse-example-case-portal`).

## Defaults (assume unless user overrides)

| Setting | Default | User override |
|---|---|---|
| API base URL | `https://api.dataverse-contact.tnapps.co.uk` | "my API is at X" |
| Scope | `default` | "use scope X" |
| Access tier | `me` | "team" or "all" |
| Stack | Vite + React 19 + TypeScript + Tailwind v4 + `@auth0/auth0-react` | rarely overridden |
| SDK | `@truenorth-it/dataverse-client` (use it — don't hand-roll fetch) | — |
| Target tables | inferred from the prompt ("case" → `incident`, "booking" → `msdyn_bookableresourcebooking`, etc.) | explicit table names |

When you apply defaults, state them in one sentence before scaffolding — don't interrogate the user first. Example: "Scaffolding against the production API in the `me` tier for the `incident` table — say stop if that's wrong."

## Auth0 values

Auth0 `domain` and `audience` are tenant-specific and are NOT baked into this skill. Strategy:

1. If a sibling directory (e.g. `../dataverse-example-case-portal/.env`) exists, read the `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_AUDIENCE` from it — they apply to every portal in the same tenant.
2. Otherwise ask the user once for both values.
3. `VITE_AUTH0_CLIENT_ID` always needs a new Auth0 SPA app per portal — leave it blank in `.env` and tell the user what to do (see "Post-scaffold instructions" below).

## Prerequisite: the `dataverse` MCP server

This skill depends on the `dataverse` MCP tools (`whoami`, `get_schema`, `get_choices`, `list_records`, `lookup_records`). If those tools are not available in this session, stop and point the user at the quickstart: `https://api.dataverse-contact.tnapps.co.uk/docs/CLAUDE-CODE-QUICKSTART.md`. Do not proceed blind — guessing field names against a live schema wastes everyone's time.

## Workflow

### 1. Confirm intent (one sentence)

State the defaults you're assuming and the target table(s). Ask only if the prompt is genuinely ambiguous (e.g. "build me a portal" with no noun).

### 2. Discovery (always run before writing code)

Use the `dataverse` MCP — never guess field names:

1. `whoami` — check the user's permissions include the requested tier (`me` / `team` / `all`) for the target table.
2. `get_schema` for each target table — returns fields, types, defaults, expands, permissions.
3. `get_choices` for every field where `type === "choice"` — returns option set values and labels.
4. For related data (e.g. case → casenotes), `get_schema` those too.

Cache the schema result — you'll use it to generate both the TypeScript types and the `select` field lists.

### 3. Scaffold

Run from the cwd the user invoked you in. If it's already a populated folder, ask before overwriting.

```bash
npm create vite@latest <name> -- --template react-ts
cd <name>
npm install
npm install @auth0/auth0-react @truenorth-it/dataverse-client
npm install -D tailwindcss @tailwindcss/vite
```

### 4. Generate files

Mirror this layout (from `dataverse-example-case-portal/`):

```
src/
├── App.tsx              ← Auth0 gate + layout
├── main.tsx             ← Auth0Provider wrapper
├── env.ts               ← requireEnvVar() for the four VITE_* vars
├── index.css            ← Tailwind @import
├── services/
│   └── <table>Api.ts    ← SDK-based functions (fetchX, createX, updateX)
├── hooks/
│   └── use<Table>.ts    ← React hook for data + state
├── types/
│   └── <table>.ts       ← types derived from get_schema output
├── components/
│   ├── LoginScreen.tsx
│   ├── Header.tsx
│   ├── <Table>Table.tsx
│   └── <Table>Detail.tsx
└── utils/
    ├── format.ts
    └── style.ts
```

Non-negotiable rules (the reference portal enforces them):

- Files **under 300 lines**. Split components, extract hooks.
- One concern per file. Types in `types/`, helpers in `utils/`, hooks in `hooks/`, services in `services/`.
- No barrel exports. Import directly from the defining file.
- No code shared with the API repo — all data via HTTP through the SDK.
- Use the SDK's scope clients: `client.me.list<T>("case", { select, top, orderBy })`. Don't hand-roll fetch.

### 5. Environment

Write `.env.example`:

```
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=            # create a new Auth0 SPA app for this portal
VITE_AUTH0_AUDIENCE=https://dataverse-api
VITE_API_BASE_URL=https://api.dataverse-contact.tnapps.co.uk
```

Copy to `.env`, filling in everything except `VITE_AUTH0_CLIENT_ID`.

### 6. Run & verify

- `npm run typecheck` — must pass clean
- `npm run dev` in the background — report the URL
- Stop. Don't iterate further until the user has looked at it.

### 7. Post-scaffold instructions (tell the user)

Print this checklist verbatim at the end:

> **One-time Auth0 setup for this portal:**
> 1. In Auth0, create a new **SPA Application** (same tenant as the API).
> 2. Copy the Client ID into `.env` as `VITE_AUTH0_CLIENT_ID`.
> 3. In the Auth0 app settings, add `http://localhost:5173` to **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**. Repeat for the production URL once deployed.
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

Then in the Vercel dashboard set the four `VITE_*` env vars, and in Auth0 add the Vercel URL to **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**.
