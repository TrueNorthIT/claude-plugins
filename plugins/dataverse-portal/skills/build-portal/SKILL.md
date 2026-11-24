---
name: build-portal
description: Scaffold a new React + TypeScript + Tailwind SPA that signs citizens in with Microsoft Entra External ID (MSAL) and consumes the Dataverse Contact API, end-to-end from a single prompt. Use when the user asks to build, scaffold, or create a portal / UI / app / frontend against a Dataverse table — e.g. "build me a case portal", "build me a case portal using https://api.dataverse-contact.tnapps.co.uk", "scaffold a UI for the booking table in scope pilot", "create a contacts app". The skill authenticates via the @truenorth-it/contact-admin CLI — no MCP registration needed.
---

# build-portal

End-to-end scaffold of a Vite + React + TypeScript + Tailwind SPA against the Dataverse Contact API, signing in against **Microsoft Entra External ID** with MSAL. The skill handles API discovery, admin authentication, scope provisioning if requested, table scaffolding, and the final frontend.

One thing it cannot do: create the Entra app registration. Those are made by hand in Azure and consumed as IDs — see step 8.

## Prerequisites

This skill requires the `@truenorth-it/contact-admin` CLI. If not already installed globally, install it at the start:

```bash
npm install -g @truenorth-it/contact-admin
```

All admin operations use this CLI instead of MCP. No MCP registration is needed.

**What the user has to supply, and when.** Most of the configuration is derived
from the API in step 0 — don't ask for any of it up front:

| | Where it comes from |
|---|---|
| API URL | The prompt, or the default |
| Tenant ID, API app ID, OAuth scope | Auto-derived from `.well-known` in step 0 |
| **SPA client ID** | **Asked in step 8** — an Entra app registration in their Azure tenant. Nothing on the API side knows it, and this skill cannot create it |
| Admin credential | Device-code sign-in in step 1 |

Two things are the user's environment, not this skill's job, and both are worth
naming early because each produces a *working* app that shows nothing:

- **A Dataverse `contact` row whose `emailaddress1` matches the address they
  sign in with.** Without it they authenticate perfectly and every `/me` route
  404s. Check with `GET /api/v2/{scope}/me/whoami` — `dataverseContact: null`
  is the tell.
- **Rows in the target table that belong to that contact.** An empty table and a
  broken join look identical from the browser.

If either is missing, say so before scaffolding rather than after.

## Trigger-time data from the prompt

| Signal | How to detect | How to use |
|---|---|---|
| API URL | Any `https://…` URL in the prompt whose host looks like an API endpoint | `API_URL` — the base for all HTTP + MCP endpoints |
| Scope | "in scope X" / "scope=X" / "use scope X" | `TARGET_SCOPE` — URL scope + provisioning target |
| Access tier | "me" / "team" / "all" | `TIER` |
| Target table | "case portal" → `case` + `casenotes`; "booking" → `msdyn_bookableresourcebooking`; etc. | Drives table publishing (use reference schemas for case portals, setup-table for others) |
| Project name | Repeats the portal noun (`case-portal`, `bookings-pilot`) or explicit "project X" | Folder name + Vite project name |

Defaults when absent:

| Default | Value |
|---|---|
| `API_URL` | `https://api.dataverse-contact.tnapps.co.uk` |
| `TARGET_SCOPE` | **asked** — see step 0. Don't silently default to `default` — the user gets a one-question choice between `default` and a sensibly-named new scope. |
| `TIER` | `me` |
| Project name | slugified portal noun |

For the URL, tier, and project name: state what you assumed in one sentence before work starts — don't interrogate. Two things are interactive: the scope question (step 0) and the SPA client ID (step 8).

## Version check

**Expected plugin version: 0.23.0**

Before doing any work, verify the installed plugin version. Read the plugin manifest at `../../.claude-plugin/plugin.json` (relative to this skill file) using the Read tool:

- If the `version` field matches `0.23.0` or is newer — proceed.
- If the `version` field is **older** — tell the user: "Your dataverse-portal plugin is v`<installed>` but this skill expects v0.23.0. Run `/plugin marketplace update truenorthit` and then `/reload-plugins` to get the latest version." Then stop.
- If the file cannot be read — warn the user but proceed.

## Workflow

All admin operations use the `contact-admin` CLI with `--json` for structured output. The global flags `--url` and `--scope` are passed to every command. For brevity the examples below assume `API_URL` and `TARGET_SCOPE` are set as shell variables.

### 0. Discover the deployment and resolve the scope

Read `references/discovery.md` now and run its two public calls (no auth): the
`.well-known/oauth-protected-resource` document, parsed with `node -e` and
guarded so a non-CIAM issuer stops the skill, and `contact-admin scopes list`.
It has the field map (`idp_provider`, `idp_issuer`, `idp_audience`, the
`auth0_*` aliases to ignore) and the shell that derives `TENANT_ID` and
`ENTRA_API_SCOPE`. In short:

- **Only Entra External ID (CIAM) is supported.** `idp_provider` must be
  `entra-external-id` **and** `idp_issuer` a `ciamlogin.com` issuer; anything
  else stops the skill. Never reach for `@auth0/auth0-react` or `VITE_AUTH0_*`.
- **Strip a leading `api://` from `idp_audience`** before appending
  `/access_as_user`.
- **The SPA client ID is not in the discovery document.** Step 8 asks for it.
- Cache `TENANT_ID`, `IDP_AUDIENCE` and `ENTRA_API_SCOPE` for step 8.

**Resolve `TARGET_SCOPE` now — before step 1.** Authentication needs the scope.

If the user named a scope in the prompt (e.g. "in scope case-portal"), use it. Otherwise, present a **numbered list** so the user can pick with a single keystroke:

Infer a suggested new scope name from the portal noun ("case portal" → `case-portal`, "bookings" → `bookings`, etc.). Then present:

> **Which scope for this portal?**
> 1. `default` (existing)
> 2. `citizenbooking` (existing)
> 3. Create new scope `case-portal`
>
> Pick a number or type a scope name:

Rules:
- List every existing scope as a numbered option.
- The last option is always "Create new scope `<suggested-name>`".
- If the portal noun matches an existing scope exactly, highlight it: e.g. "1. `case-portal` (existing — matches your portal name) **recommended**".
- Otherwise mark the new scope **recommended**. A scope is the unit of isolation for routes and permissions: every portal pointed at it shares its tables, its baseline permissions and its per-person grants, so a second portal in an existing scope inherits whatever the first one needed. `default` is the scope everything shares — fine for trying the API, not for a portal real people will use.
- Accept a number, an existing scope name, or a new name the user types.

Wait for their reply, then use their choice as `TARGET_SCOPE` for everything that follows. **Do not proceed to step 1 until `TARGET_SCOPE` is decided.**

### 1. Authenticate

This is the **admin** login — workforce Entra, for publishing tables and reading scope config. It is a different credential from the citizen sign-in the portal itself will use. Two steps, so the verification URL is visible to the user.

**Step 1a — get the device code (instant):**

```bash
contact-admin device-code --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

This returns immediately with JSON containing `verificationUrl`, `userCode`, `deviceCode`, `interval`, and `expiresIn`. **Print the URL to the user as a message** — do NOT rely on Bash output being visible:

> **Open this URL to authorise:** `<verificationUrl>`
>
> Polling automatically — just approve in the browser and I'll continue.

**Step 1b — poll for approval (blocks):**

```bash
contact-admin device-poll --url "${API_URL}" --device-code "<deviceCode>" --interval <interval> --expires-in <expiresIn> --json
```

This blocks until the user approves, then stores the key in `~/.contact-admin/keys.json`. Parse the `--json` response for `scopeCreated` to know if the scope was just provisioned.

If the user is already logged in for this URL + scope (key exists and hasn't expired), skip straight to step 2.

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

Skip tables that are already published. For each table the portal needs that is NOT yet published, follow ONE of the paths below in priority order — and whichever path produced the schema, put it through **Before you publish** (the end of `references/tables.md`) first. Publishing is the moment a route becomes reachable, by anyone holding a token the scope accepts, with or without this portal.

**Read `references/tables.md` before saving or publishing any table.** It holds:

| Path | When | What's in the reference |
|---|---|---|
| A — reference schema | **Mandatory for case portals** | `CASE_SCHEMA` (route `case` over `incident`) and `CASENOTES_SCHEMA` (route `casenotes` over `annotation`), verbatim, with why each part matters. Publish `case` first, then `casenotes` |
| B — copy from `default` | A table the default scope already publishes | `tables get … --scope default`, fix `lookupTable` values, then save and publish |
| C — scaffold from discovery | Last resort | `setup-table <entity> --no-publish`, never letting the scaffolder publish; join-ambiguity and empty-table handling |

The *Before you publish* checklist covers: `fields` cut to what the portal uses, identity and
status columns `readOnly`, lookups `readOnly` or given a `lookupTable`, no
`publicRead`/`publicCreate` nobody asked for, no unscoped `fetchXml`, and a
decision on staff-written notes.

### 5. Verify tables return data

After publishing, smoke-test every table through the full API pipeline:

```bash
contact-admin tables test-query <routeName> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

This runs the query through config filters, join paths, and OData building — exactly like a real API request. If it returns records, the table works. If it returns an error or 0 records, the schema is broken (wrong join path, bad filter, missing field config).

To simulate a specific user's view:
```bash
# Simulate /me — pass a Dataverse contact GUID
contact-admin tables test-query <routeName> --tier me --contact-id <guid> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json

# Simulate /team — pass an account GUID
contact-admin tables test-query <routeName> --tier team --account-id <guid> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

If `test-query` returns 0 records with no error, the table config is valid but there's no matching data (or the join path doesn't connect to any records). Tell the user.

If `test-query` returns a Dataverse error, the schema needs fixing — read the error message (e.g. "Could not find property X") and fix the published schema before proceeding.

Records coming back proves the route reaches data. It does not prove the route keeps anyone *out*, and that takes one more call per route:

```bash
# A contact id that matches nobody must see nothing. Any rows here mean the
# route is not filtering by caller at all — stop, and fix it before scaffolding.
contact-admin tables test-query <routeName> --tier me --contact-id 3f2a8c1e-0000-4000-8000-000000000000 --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

If two real contacts are to hand, run `--tier me` for each and check they get different rows. A route that hands everyone the same list is the failure this catches — usually a FetchXML template without its `{{contactid}}` placeholder, which replaces the join path. For a route that serves `team`, run the same check with `--tier team --account-id <a GUID matching no account>`.

### 6. Inspect published schema

For each target table:

```bash
# Full schema with fields/types/expands
contact-admin tables get <routeName> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json

# Picklist values (public, no auth)
curl -s "${API_URL}/api/v2/${TARGET_SCOPE}/choices/<routeName>"
```

Use these to choose the screens, `select` lists and expands. **Do not hand-write
TypeScript types from them.** Step 7 generates the types from the same public
schema.

### 7. Scaffold the frontend

Read the reference for each part as you reach it:

| Before you… | Read |
|---|---|
| run `npm create vite`, install packages and generate types | `references/scaffold.md` — the house stack, the exact commands, the `dataverse.generated.ts` exports, the file layout |
| write `src/config/entra.ts`, `src/main.tsx`, `src/auth.tsx` or the no-contact screen | `references/auth.md` — *Entra wiring* (the four files that must be right, the `QueryClient` settings, the dev-token escape hatch) and *Contact resolution* |
| write `src/lib/client.ts` and `services/*Api.ts` | `references/sdk-usage.md` — the only acceptable SDK pattern, tiers, custom APIs, filters |
| write hooks and components | `references/code-quality.md` — commented SDK calls, `useInfiniteQuery` paging, mutations, TODOs, generated types in use |
| render API data, build a link, read a route param or show an error | `references/code-security.md` — `SafeHtml`, `safeHref`, the GUID check, `friendlyError`, files, realtime, query keys |

Non-negotiable rules:

- Files under 300 lines. Split components; extract hooks.
- One concern per file.
- No barrel exports.
- **Always use the `@truenorth-it/dataverse-client` SDK. Never hand-roll fetch, never build OData query strings, never set the `Authorization` header yourself.** The SDK's scope clients (`client.me`, `client.team`, `client.all`) handle auth, query encoding, pagination, and error shapes. That includes custom APIs: `client.me.invokeFunction` / `invokeAction` (SDK 1.26.0 and later) call one on the `me` tier with the citizen's token, the record in `recordId` — see `references/sdk-usage.md`.
- **Redirect flows only, never popup.** Popups get blocked, and on a phone a popup sign-in is worse than a redirect in every way. `loginRedirect`, `acquireTokenRedirect`, `logoutRedirect`.
- **Every list pages.** A `list` call returns one page: 20 rows by default and never more than 100, because a larger `top` is cut to 100 without an error. A list screen that calls `list` once shows the first page and nothing else. Use `useInfiniteQuery`, following `page.next` with `fetchPage`, and give the screen a "Load more" button. Drain every page with `eachPage` only for a bounded set (a dropdown's options, an export), never for a screen that grows with the data. See `references/code-quality.md` for the hook.
- **Every SDK call is typed from `dataverse.generated.ts`.** Reads pass the row type (`list<Case>`) and take `QueryOptionsFor<CaseField>`. Writes take `CaseCreateInput` / `CaseUpdateInput`, not `Partial<Case>`. Choice values come from the generated consts. No hand-written table interfaces, and no `as` casts on SDK results.
- **The rules in `references/code-security.md` (*Security — what the generated code must not do*) are non-negotiable too.** In short: the tier the user chose and no wider; API text rendered as text; route params checked; nothing secret in `VITE_*`; citizens shown friendly errors, not the API's.

### 8. Environment — and the one thing you must ask for

Three of the five values come from step 0. The fourth is the user's.

**The SPA client ID is not discoverable, and this skill cannot create it.** Entra app registrations are made by hand in Azure — Terraform doesn't create them either, and there is no `contact-admin` command that will. So ask, in one message, and say exactly what you're asking for:

> I need the **client ID of the Entra app registration** for this portal — a GUID from your Entra External ID tenant.
>
> If one doesn't exist yet, it takes two minutes in the Azure portal: **App registrations → New registration**, then **Authentication → Add a platform → Single-page application** with `http://localhost:5173` as the redirect URI, then **API permissions → My APIs →** the API app → tick `access_as_user` → **Grant admin consent**.
>
> Paste the Application (client) ID and I'll finish the wiring.

**The redirect URI must have no trailing slash.** `window.location.origin` never produces one, Entra compares the string exactly, and a mismatch is rejected at the IdP as `AADSTS50011` *before the app runs* — so nothing in the browser console explains it. Register `http://localhost:5173`, not `http://localhost:5173/`. Say this while asking; it is the single most common way this goes wrong.

It must also be added under the **Single-page application** platform, not Web. A Web-platform redirect URI on the same app fails the PKCE flow with a different, equally unhelpful error.

Two more settings are easier to get right now than to find later:

- **Leave implicit grant off.** The two checkboxes under Authentication → *Implicit grant and hybrid flows* stay unticked. MSAL v5 uses the authorization-code flow with PKCE, and ticking them only re-opens the older flow, which returns tokens in the URL.
- **Register exact redirect URIs, no wildcards.** One per origin that really serves the portal.

Then write `.env.example` and `.env` with every value filled in:

```
VITE_ENTRA_TENANT_ID=${TENANT_ID}                       # parsed from idp_issuer
VITE_ENTRA_CLIENT_ID=<the SPA app registration client ID the user gave you>
VITE_ENTRA_API_SCOPE=${ENTRA_API_SCOPE}                 # from step 0 — api://<guid>/access_as_user
VITE_API_BASE_URL=${API_URL}                            # origin only — no trailing slash, no path
VITE_API_SCOPE=${TARGET_SCOPE}
```

Notes worth putting in `.env.example` as comments:

- `VITE_ENTRA_API_SCOPE` carries exactly **one** `api://` prefix. `idp_audience` frequently already holds the full Application ID URI, so blindly prefixing it yields `api://api://<guid>/access_as_user`, which Entra rejects as an unknown scope and no one can sign in.
- `VITE_API_BASE_URL` is the **origin only**. The SDK builds every URL as `${base}/api/v2/${scope}${path}`, so a trailing slash or a `/api/v2` suffix produces doubled paths and 404s.
- Vite inlines `VITE_*` at **build time**. Changing them on a host without a redeploy does nothing — a real trap on Vercel, where the variable looks set and the bundle still carries the old value.
- Nothing here is secret. `clientId`, the authority, the API scope string and the API URL are all public and ship in the bundle by design.

**Production URL:** if the user names a prod URL (e.g. "deploy to Vercel later"), tell them to add that origin as a second SPA redirect URI before the first deploy; `window.location.origin` picks the right one at runtime. One registration serving both is fine while building. Before go-live, take the `http://localhost` URIs off the registration production uses, or keep a separate registration for development: Microsoft's guidance is that production apps shouldn't accept a localhost redirect.

### 9. Run & verify

```bash
npm run typecheck   # must pass clean
npm run dev &       # background, report URL
```

**Port mismatch?** Vite picks the next free port if 5173 is taken (5174, 5175, …). If `npm run dev` reports anything other than 5173, sign-in will fail at Entra with `AADSTS50011` — and this skill cannot fix it for the user. Tell them plainly:

> Vite started on port `<actual-port>` instead of 5173. Add `http://localhost:<actual-port>` (no trailing slash) as a Single-page application redirect URI on app registration `<clientId>` in the Azure portal — Authentication → Single-page application → Add URI. Sign-in will fail with `AADSTS50011` until you do. Alternatively, stop whatever is on 5173 and restart.

### 10. Offer to grant the first user access

Identity comes from Entra; **authorisation comes from the API**, not from Entra roles or token claims. The scope's `defaults.json` is a baseline for every token the scope accepts, and per-user escalations live in `cpa_apipermission`. "Every token" is broader than it sounds. It includes callers with no Dataverse contact at all, who are shut out of `me` and `team` but not `all`. It also includes users of every other portal on the deployment, unless this scope has its own OIDC audience. That is why the baseline should never hold `all`, or any action ending in `:all`.

**A scope created in this session has no baseline yet, so it grants nothing.** Every route answers 403 except to the people you grant here, which is the safe way for it to fail. Publishing a baseline is a scope-design decision, made in Terraform (`dataversecontact_permissions_sync`, the `dataverse-terraform` plugin) or the Table Manager; this CLI has no command for it. Say so rather than granting everyone individually.

Check what the baseline already covers before granting anything:

```bash
contact-admin access defaults --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

Then ask the user in one sentence whether to add a user now:

> Portal wired to Entra app registration `<short-prefix>...` on tenant `<tenant-prefix>...`, pointing at scope `<scope>`. Reload `http://localhost:5173` when ready.
>
> **Want me to grant a user extra permissions right now?** Give me an email and I'll grant a sensible starter set on top of the scope defaults.

If the user says yes with an email:

1. Compute the starter permission set from the scope's tables, minus whatever `access defaults` already grants. For a new scope you just populated, this is typically the `me`-tier read/write/create perms for every table:
   - `<table>` (read my records)
   - `<table>:write` (update my records)
   - `<table>:create` (create records auto-bound to me)
   - `<table>:lookup` (resolve lookups)
   - Repeat for related tables, but only with what the portal does: for `casenotes`, read and `create` — not `write`, which would let the citizen edit staff notes on their case
2. Grant the permissions:
   ```bash
   contact-admin access grant "<email>" \
     --permissions "<table>,<table>:write,<table>:create,<table>:lookup" \
     --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
   ```
3. Confirm what they actually end up with — effective = scope defaults ∪ explicit grants:
   ```bash
   contact-admin access show "<email>" --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
   ```
4. Relay the response:
   > Granted 4 permissions to `<email>` on scope `case-portal`; effective set is now `<…>`.
   >
   > Permissions are cached for 5 minutes, so give it that long before deciding a grant didn't work.

If the user wants team-tier or admin-tier access, expand the list accordingly (e.g. add `<table>:team` + `<table>:write:team`, or `<table>:all` + `<table>:write:all`), and say what it means before granting:

- **`:all` is every row in the table**, for that person, through any portal on the scope. `write:all` also lets them point a writable lookup at any row. Grant it to named staff who need it, never to a test citizen "to make it work". A 403 on a citizen portal is answered by fixing the join or the tier, not by widening the grant.
- **`:team` is only as narrow as the account model.** If contacts were bulk-loaded under one catch-all account, `team` is every citizen.
- **A grant follows the email address.** Whoever can sign in with it holds it.
- **To withdraw a grant, `contact-admin access revoke`** (it deletes the `cpa_apipermission` row; deactivating the row in Dataverse works too). Cutting someone off is different. From API 1.24.0, deactivating their *contact* does it: once every contact their email had is inactive, every data route answers 403 and they can't sign themselves up again (whoami still answers, so the portal can say why). On an older deployment deactivating isn't enough, because inactive contacts still match: block the sign-in in Entra *and* change the contact's `emailaddress1`.

Use the `access` family throughout. `contact-admin auth0 grant-access` still runs but is **deprecated** — it is a thin alias for `access grant`. The rest of the `auth0` command family (`create-spa`, `list-spas`, `update-spa`, `sync-permissions`) has been **removed** as of contact-admin 0.2.0, and did not work before that either: the MCP tools they called were registered on no server and `sync-permissions` posted to a route that did not exist. That was true on `auth0`-provider scopes too, so do not reach for them there. SPA registration is an identity-provider job now, done in the Entra admin centre.

If `access grant` returns `found: false`, there is no Dataverse **contact** with that email address. That is a Dataverse problem, not an Entra one: create the contact record (with `emailaddress1` set to exactly that address), then re-run. Signing the person up in Entra does not create a contact.

## Worked examples and failure modes

- **Worked examples** — a case portal with and without a named scope, a bookings
  portal in a new scope, an ambiguous contact join, a brand-new empty table:
  `references/examples.md`.
- **When something fails** — `AADSTS50011`, a blank page, 401 / 403 / 404, a
  write that doesn't stick, a typecheck error on a field the API has, a list
  stuck at 20 rows: read `references/troubleshooting.md` before guessing.

## Reference files

All paths are relative to this skill's directory.

| File | Read at | Holds (section names used elsewhere in italics) |
|---|---|---|
| `references/discovery.md` | Step 0 | Discovery shell, `.well-known` field map, the Auth0 warning |
| `references/tables.md` | Step 4 | Paths A / B / C, the case and case-notes schemas, *Before you publish* |
| `references/scaffold.md` | Step 7 | *The house stack*, scaffold commands, generated types, file layout |
| `references/auth.md` | Step 7 | *Entra wiring — the four files that must be right*, *Contact resolution — the 404 to design for* |
| `references/sdk-usage.md` | Step 7 | *SDK usage — the only acceptable pattern* |
| `references/code-quality.md` | Step 7 | *Code quality — the scaffolded code must teach* |
| `references/code-security.md` | Step 7 | *Security — what the generated code must not do* |
| `references/security.md` | Before go-live | Response headers (CSP) and go-live checks |
| `references/examples.md` | Any time | *Worked examples* |
| `references/troubleshooting.md` | Steps 5, 9, or on any failure | *Failure modes worth recognising* |

## Dependencies

This skill shells out via `Bash` for:
- `contact-admin` — all admin operations (auth, scopes, tables, access grants)
- `curl` — `/.well-known` discovery + choices endpoint
- `node -e` — JSON extraction from curl responses (portable; works on Git Bash, macOS, Linux)
- `sed` — parsing the tenant GUID out of `idp_issuer`
- `npm` / `npx` — scaffold, `dataverse-client generate` (types), and type-check

**Never use `jq`.** It isn't installed on Windows Git Bash or many corporate envs, and missing-command failures in mid-flow break the skill silently. Always reach for `node -e` when you need to parse JSON from a curl response.

The plugin's `.claude/settings.json` pre-approves these so the skill doesn't pause for permissions mid-flow.
