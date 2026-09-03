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

## Trigger-time data from the prompt

| Signal | How to detect | How to use |
|---|---|---|
| API URL | Any `https://…` URL in the prompt whose host looks like an API endpoint | `API_URL` — the base for all HTTP + MCP endpoints |
| Scope | "in scope X" / "scope=X" / "use scope X" | `TARGET_SCOPE` — URL scope + provisioning target |
| Access tier | "me" / "team" / "all" | `TIER` |
| Target table | "case portal" → `incident` + `casenotes`; "booking" → `msdyn_bookableresourcebooking`; etc. | Drives table publishing (use reference schemas for case portals, setup-table for others) |
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

**Expected plugin version: 0.12.0**

Before doing any work, verify the installed plugin version. Read the plugin manifest at `../../.claude-plugin/plugin.json` (relative to this skill file) using the Read tool:

- If the `version` field matches `0.12.0` — proceed.
- If the `version` field is **older** — tell the user: "Your dataverse-portal plugin is v`<installed>` but this skill expects v0.12.0. Run `/plugin marketplace update truenorthit` and then `/reload-plugins` to get the latest version." Then stop.
- If the file cannot be read — warn the user but proceed.

## Workflow

All admin operations use the `contact-admin` CLI with `--json` for structured output. The global flags `--url` and `--scope` are passed to every command. For brevity the examples below assume `API_URL` and `TARGET_SCOPE` are set as shell variables.

### 0. Discover the deployment and resolve the scope

Two parallel calls (both public, no auth):

```bash
# Identity-provider config for the portal's .env
WELL_KNOWN=$(curl -s "${API_URL}/.well-known/oauth-protected-resource")
field() { echo "$WELL_KNOWN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d)['$1']??'')))"; }
IDP_PROVIDER=$(field idp_provider)
IDP_ISSUER=$(field idp_issuer)
IDP_AUDIENCE=$(field idp_audience)

# Entra issuers are https://<tenantId>.ciamlogin.com/<tenantId>/v2.0 —
# the tenant GUID appears twice, so either occurrence will do.
TENANT_ID=$(echo "$IDP_ISSUER" | sed -E 's#^https://([^.]+)\.ciamlogin\.com/.*#\1#')
ENTRA_API_SCOPE="api://${IDP_AUDIENCE}/access_as_user"
```

```bash
# Existing scopes
contact-admin scopes list --url "${API_URL}" --json
```

Field map from `.well-known`:

| JSON field | What it is / where it goes |
|---|---|
| `idp_provider` | Which IdP the deployment uses. **Branch on this.** `entra-external-id` (also `azure-b2c`, and workforce Entra) → everything below. Anything else → stop, and tell the user this skill only scaffolds Entra portals. |
| `idp_issuer` | `https://<tenantId>.ciamlogin.com/<tenantId>/v2.0`. Parse the tenant GUID out of it → `VITE_ENTRA_TENANT_ID` |
| `idp_audience` | The API app registration's client ID — a **bare GUID**, not prefixed with `api://`. Build `api://<idp_audience>/access_as_user` from it → `VITE_ENTRA_API_SCOPE` |
| `resource` | Same value as `idp_audience`. Informational |
| `auth0_*` | **Ignore.** Backwards-compatibility aliases from before the Entra migration. On an Entra deployment `auth0_domain` holds a `ciamlogin.com` URL, so feeding it to an Auth0 SDK produces an app that builds, runs, and never signs anyone in. |

There is exactly **one** coarse scope — `access_as_user`. No app roles, no per-permission scopes, no group claims. Everything about who may read or write what is decided inside the API from the scope's `defaults.json` plus `cr_apipermission`; see step 10.

**Not in the discovery document: the SPA client ID.** It belongs to an app registration in the customer's Azure tenant and nothing on the API side knows about it. Step 8 asks the user for it. Nothing before then needs it, so don't ask yet.

Cache `TENANT_ID`, `IDP_AUDIENCE` and `ENTRA_API_SCOPE` for step 8.

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

Skip tables that are already published. For each table the portal needs that is NOT yet published, follow ONE of the paths below in priority order:

#### Path A — Use a reference schema (MANDATORY for case portals)

For **case portals**, ALWAYS use these exact schemas. Do NOT scaffold `incident` or `annotation` from discovery — the scaffolder gets the join paths, filters, and polymorphic lookups wrong.

Publish `incident` first, then `casenotes`:

```bash
contact-admin tables save-draft incident --schema '<INCIDENT_SCHEMA>' --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables publish --tables incident --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables save-draft casenotes --schema '<CASENOTES_SCHEMA>' --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables publish --tables casenotes --url "${API_URL}" --scope "${TARGET_SCOPE}"
```

**INCIDENT_SCHEMA** — the `incident` table (cases):
```json
{"routeName":"incident","description":"Cases and support tickets","dataverseTable":"incidents","dataverseLogicalName":"incident","requiredPermission":"incident","primaryKey":"incidentid","defaultSelect":["incidentid","title","ticketnumber","statecode","statuscode","prioritycode","casetypecode","createdon","modifiedon"],"contactJoinPath":[{"table":"contacts","from":"customerid_contact","key":"contactid"}],"alternateContactJoinPaths":[[{"table":"contacts","from":"primarycontactid","key":"contactid"}]],"teamJoinPath":[{"table":"accounts","from":"customerid_account","key":"accountid"}],"createDefaults":[{"field":"customerid_account","bindTo":"account","entitySet":"accounts"},{"field":"primarycontactid","bindTo":"contact","entitySet":"contacts"}],"lookupFields":["ticketnumber","title"],"lookupSearchContains":["ticketnumber","title"],"filters":["statecode eq 0"],"fields":{"incidentid":{"type":"string","description":"Unique case identifier","readOnly":true},"ticketnumber":{"type":"string","description":"Case number","readOnly":true},"title":{"type":"string","description":"Case title"},"description":{"type":"string","description":"Case description"},"statecode":{"type":"choice","description":"Case status"},"statuscode":{"type":"choice","description":"Status reason"},"prioritycode":{"type":"choice","description":"Priority"},"casetypecode":{"type":"choice","description":"Case type"},"caseorigincode":{"type":"choice","description":"Case origin"},"createdon":{"type":"datetime","description":"Date created","readOnly":true},"modifiedon":{"type":"datetime","description":"Date last modified","readOnly":true},"customerid":{"type":"lookup","description":"Customer (contact or account)","readOnly":true},"primarycontactid":{"type":"lookup","description":"Primary contact","lookupTable":"contact"},"ownerid":{"type":"lookup","description":"Record owner","readOnly":true}}}
```

Why this schema matters:
- `contactJoinPath` uses `customerid_contact` — NOT `responsiblecontactid` or `ownerid` which the scaffolder picks and which returns no data for `/me` routes
- `createDefaults` auto-binds the logged-in user's contact and account when creating cases
- `filters: ["statecode eq 0"]` shows only active cases

**CASENOTES_SCHEMA** — annotations filtered to cases (route name is `casenotes`, NOT `annotation`):
```json
{"routeName":"casenotes","description":"Notes and annotations linked to cases","dataverseTable":"annotations","dataverseLogicalName":"annotation","requiredPermission":"casenotes","primaryKey":"annotationid","aliases":["casenote"],"defaultSelect":["annotationid","subject","notetext","incidentid","isdocument","createdon","modifiedon"],"contactJoinPath":[{"table":"incidents","from":"objectid_incident","key":"incidentid"},{"table":"contacts","from":"customerid_contact","key":"contactid"}],"alternateContactJoinPaths":[[{"table":"incidents","from":"objectid_incident","key":"incidentid"},{"table":"contacts","from":"primarycontactid","key":"contactid"}]],"teamJoinPath":[{"table":"incidents","from":"objectid_incident","key":"incidentid"},{"table":"accounts","from":"customerid_account","key":"accountid"}],"filters":["objecttypecode eq 'incident'"],"parentTable":{"table":"incident","navigationProperty":"objectid_incident"},"lookupFields":["subject"],"lookupSearchContains":["subject"],"fields":{"annotationid":{"type":"string","description":"Unique note identifier","readOnly":true},"subject":{"type":"string","description":"Note subject / title"},"notetext":{"type":"string","description":"Note body text"},"isdocument":{"type":"boolean","description":"Whether the note has a file attachment","readOnly":true},"filename":{"type":"string","description":"Attachment file name","readOnly":true},"filesize":{"type":"number","description":"Attachment file size in bytes","readOnly":true},"mimetype":{"type":"string","description":"Attachment MIME type","readOnly":true},"incidentid":{"type":"lookup","description":"Parent case","lookupTable":"incident","valueField":"objectid","bindField":"objectid_incident"},"objecttypecode":{"type":"string","description":"Regarding entity type","readOnly":true},"ownerid":{"type":"lookup","description":"Record owner","readOnly":true},"createdon":{"type":"datetime","description":"Date created","readOnly":true},"modifiedon":{"type":"datetime","description":"Date last modified","readOnly":true}}}
```

Why this schema matters:
- Route name is `casenotes` — do NOT publish a generic `annotation` route
- `lookupTable` uses `"incident"` (the Dataverse logical name) so it resolves in any scope
- `incidentid` has `valueField: "objectid"` and `bindField: "objectid_incident"` for the polymorphic lookup — without this, writes fail with "Invalid property 'incidentid'"
- `contactJoinPath` is two hops: annotation → incident → contact (via `customerid_contact`)
- `filter: ["objecttypecode eq 'incident'"]` restricts to case-linked notes only

For the frontend, scope child records to their parent:
```ts
const notes = await client.me.list<CaseNote>("casenotes", {
  filter: { field: "incidentid", operator: "eq", value: caseId },
});
```

#### Path B — Copy from default scope

For tables NOT covered by the reference schemas above, check if the default scope has a working config:

```bash
contact-admin tables get <routeName> --url "${API_URL}" --scope default --json
```

If found, check any `lookupTable` values in the fields — change them to the Dataverse logical name (e.g. `"incident"` not `"case"`) so they resolve in any scope. Then save and publish:

```bash
contact-admin tables save-draft <routeName> --schema '<the-schema-json>' --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables publish --tables <routeName> --url "${API_URL}" --scope "${TARGET_SCOPE}"
```

#### Path C — Scaffold from discovery (last resort)

Only use this for tables that have no reference schema AND don't exist in the default scope:

```bash
contact-admin setup-table <entity> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

**Join-ambiguity handling:** If the response includes `joinAnalysis.contactJoinAmbiguous: true` or `joinAnalysis.accountJoinAmbiguous: true`:

1. Run `contact-admin tables sample-data <entity> --top 3 --json` to inspect the chosen join's lookup values.
2. **Pause and ask the user** in one sentence, e.g.:
   > "On `incident` I found two contact joins: `customerid → contact` and `ownerid → contact`. The scaffold picked `customerid`. Sample rows show `customerid` = [Alice, Bob, (null)]. Confirm, or say which to use."
3. If the user picks a different join, use the granular commands:
   ```bash
   contact-admin tables scaffold <entity> --json   # get the schema
   # modify schema.contactJoinPath / schema.teamJoinPath
   contact-admin tables save-draft <routeName> --schema '<modified-json>'
   contact-admin tables publish --tables <routeName>
   ```

**Empty-table case:** if `sample-data` returns `count: 0`, don't block. Tell the user: "No rows in `<entity>` yet — join was chosen from metadata only; double-check once real data lands."

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

### 6. Inspect published schema

For each target table:

```bash
# Full schema with fields/types/expands
contact-admin tables get <routeName> --url "${API_URL}" --scope "${TARGET_SCOPE}" --json

# Picklist values (public, no auth)
curl -s "${API_URL}/api/v2/${TARGET_SCOPE}/choices/<routeName>"
```

Cache these for TypeScript type generation and SDK `select` lists.

### 7. Scaffold the frontend

#### The house stack

Scaffold this unless the user asks for something else. It is what the existing
portals run, so a developer moving between them meets the same shapes:

| | | |
|---|---|---|
| **React** | 19 | |
| **Vite** | latest | build and dev server; no dev proxy — the API is CORS-enabled |
| **TypeScript** | strict | |
| **TanStack Query** | v5 | **all server state.** No `useEffect` fetching, no SWR, no Redux |
| **MSAL** | `msal-browser` ^5.18 + `msal-react` ^5.5 | Entra External ID sign-in |
| **`@truenorth-it/dataverse-client`** | latest | every API call |
| **React Router** | 7 | |
| **Tailwind** | v4, via `@tailwindcss/vite` | |
| **Node** | >= 20 | |

Forms are plain `useState` controlled components. Do not reach for
`react-hook-form` or `zod` — the existing portals declare them and use neither.

From the user's cwd, scaffold into a new subdirectory. **Do not create temp folders, scaffold elsewhere then copy, or go up a directory.** Just run Vite directly:

```bash
PROJECT_NAME=<inferred or from prompt>
npm create vite@latest "$PROJECT_NAME" -- --template react-ts
cd "$PROJECT_NAME"
npm install
npm install @azure/msal-browser@^5.18 @azure/msal-react@^5.5 react-router-dom \
  @tanstack/react-query @truenorth-it/dataverse-client
npm install -D tailwindcss @tailwindcss/vite
```

Generate code based on the table schema from step 6. The file layout should be:

```
src/
├── main.tsx                 ← MSAL bootstrap before React mounts, then the provider stack
├── App.tsx                  ← sign-in gate + router
├── auth.tsx                 ← AuthProvider / useAuth — session, getToken, signIn, signOut
├── config/entra.ts          ← msalConfig + assertEntraConfig()
├── env.ts                   ← VITE_API_BASE_URL + VITE_API_SCOPE
├── index.css                ← Tailwind @import
├── lib/client.ts            ← useDataverseClient() hook
├── services/<table>Api.ts   ← SDK-based (fetchX, createX, updateX)
├── hooks/use<Table>.ts      ← React hook for data + state
├── types/<table>.ts         ← types derived from tables get
└── components/
    ├── SignInGate.tsx       ← sign-in wall + NoContactNotice
    ├── Header.tsx
    ├── <Table>List.tsx      ← list view with loading/error/empty states
    └── <Table>Detail.tsx    ← detail view
```

Non-negotiable rules:

- Files under 300 lines. Split components; extract hooks.
- One concern per file.
- No barrel exports.
- **Always use the `@truenorth-it/dataverse-client` SDK. Never hand-roll fetch, never build OData query strings, never set the `Authorization` header yourself.** The SDK's scope clients (`client.me`, `client.team`, `client.all`) handle auth, query encoding, pagination, and error shapes.
- **Redirect flows only, never popup.** Popups get blocked, and on a phone a popup sign-in is worse than a redirect in every way. `loginRedirect`, `acquireTokenRedirect`, `logoutRedirect`.
- Generated types come from `tables get`, never guesses.

### Entra wiring — the four files that must be right

Nothing here is optional or interchangeable. Each piece exists because its absence produces a specific, badly-signposted failure.

**`src/config/entra.ts` — MSAL configuration.**

```ts
export const entraConfig = {
  tenantId: import.meta.env.VITE_ENTRA_TENANT_ID ?? '',
  clientId: import.meta.env.VITE_ENTRA_CLIENT_ID ?? '',
  /** e.g. `api://<api-app-id>/access_as_user` — the audience the API expects. */
  apiScope: import.meta.env.VITE_ENTRA_API_SCOPE ?? '',
  /**
   * Must be registered on the app registration as a Single-page application
   * redirect URI, or sign-in fails at the IdP before the app ever sees it.
   * `window.location.origin` keeps localhost and the deployed URL on one config.
   */
  redirectUri: window.location.origin,
}

export const msalConfig = {
  auth: {
    clientId: entraConfig.clientId,
    authority: `https://${entraConfig.tenantId}.ciamlogin.com/${entraConfig.tenantId}`,
    // Required: MSAL rejects an authority outside its known list otherwise.
    knownAuthorities: [`${entraConfig.tenantId}.ciamlogin.com`],
    redirectUri: entraConfig.redirectUri,
    postLogoutRedirectUri: entraConfig.redirectUri,
  },
  // Survives a full page load, so a refresh does not bounce through the IdP.
  cache: { cacheLocation: 'localStorage' as const },
}
```

Also export an `assertEntraConfig()` that throws a named-variable error when any of the three is empty — **called from `bootstrap()`, never run at module scope.** Throwing on import happens before any error handler exists, and the result is a blank white page, which is the least diagnosable failure there is. The most likely cause is also the most boring one: an unset variable on a fresh deploy.

**`src/main.tsx` — bootstrap before React mounts.**

```ts
async function bootstrap() {
  assertEntraConfig()
  const pca = new PublicClientApplication(msalConfig)

  // MSAL does not set an active account on login by itself, and
  // `acquireTokenSilent` needs one — without this every request after a fresh
  // sign-in fails until the page is reloaded.
  pca.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      const { account } = event.payload as AuthenticationResult
      if (account) pca.setActiveAccount(account)
    }
  })

  await pca.initialize()
  // Must run before anything reads the account list, or the first render after
  // returning from the IdP sees a signed-out app and bounces the user back to
  // sign in — a loop that looks like a broken login.
  await pca.handleRedirectPromise()
  if (!pca.getActiveAccount()) {
    const [first] = pca.getAllAccounts()
    if (first) pca.setActiveAccount(first)
  }

  createRoot(root).render(/* provider stack below */)
}

bootstrap().catch((err) => { /* render the message into #root as plain DOM */ })
```

Everything before React mounts sits outside any error boundary, so the `catch` must paint the message into the page itself, with plain DOM — whatever failed may well be the reason React cannot start.

**Provider order is load-bearing:**

```
MsalProvider → QueryClientProvider → AuthProvider → BrowserRouter → routes
```

`useAuth` reads MSAL, so `AuthProvider` must sit inside `MsalProvider`; anything that fetches must sit inside `AuthProvider`.

**The `QueryClient` needs two non-default settings:**

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // Query's retryer only continues while the tab is focused. A scheduled
      // retry in a background tab PAUSES, leaving status at 'pending' — so the
      // user sits on a spinner that never resolves and the error never reaches
      // the component. 'always' is what makes failures actually surface.
      networkMode: 'always',
      // Never retry a 4xx. A 403 is a permission answer and a 404 is often
      // "no contact record" — retrying either only delays the real message.
      retry: (count, error) => {
        const status = (error as { status?: number })?.status
        if (typeof status === 'number' && status >= 400 && status < 500) return false
        return count < 1
      },
    },
    mutations: { retry: false, networkMode: 'always' },
  },
})
```

Read loading state from `isSuccess`, not `!isLoading && !error`. A query can sit pending with nothing in flight — paused, disabled, or never started — and inferring "no records" from that tells someone their data is gone when you never actually asked.

**`src/auth.tsx` — session and token acquisition.** Expose `session`, `isBusy` (`inProgress !== 'none'` — mid-redirect is neither signed in nor signed out, and rendering a sign-in button there invites a second login on top of the one already running), `getToken`, `signIn`, `signOut`.

`getToken` acquires silently on every call — MSAL caches and refreshes behind it, so it is cheap, and a long-lived tab never sends a stale token. It must catch **both** error types:

```ts
try {
  const result = await instance.acquireTokenSilent({ scopes: [apiScope], account })
  return result.accessToken
} catch (err) {
  // Silent renewal happens in a hidden iframe. When the browser blocks
  // third-party cookies — increasingly the default — the iframe never
  // completes and MSAL gives up with `timed_out`, which is a BrowserAuthError
  // and NOT an InteractionRequiredAuthError. Escalating only on the latter
  // leaves a signed-in user on loading skeletons forever, on every page, with
  // no cure but signing out and back in by hand.
  const timedOut = err instanceof BrowserAuthError && /timed_?out|timeout/i.test(err.errorCode)
  if (err instanceof InteractionRequiredAuthError || timedOut) {
    await instance.acquireTokenRedirect({ scopes: [apiScope], account })
  }
  throw err
}
```

A full-page redirect isn't subject to the restriction that stopped the iframe, and when the IdP session is still alive it returns without prompting for anything.

### Contact resolution — the 404 to design for

The API resolves the Dataverse contact from the token's **lowercased `email` claim**, matched against `contact.emailaddress1`. Not `oid`, not `sub`. An account whose email has no matching contact authenticates perfectly, gets a valid token, and then 404s on every `me` route.

This is a routine outcome with a real IdP, it says nothing is wrong with the user's credentials, and the fix is a different account rather than anything they can retry. Render it as its own thing:

```tsx
// A 404 here means the token was fine but no Dataverse contact carries that
// email. Worth naming rather than showing a generic failure.
const noContact = (error as { status?: number } | null)?.status === 404
{error && noContact && <NoContactNotice email={session?.email} />}
```

`NoContactNotice` should say which email they're signed in as, suggest they may have used a different address, and offer `signOut` as "sign in as someone else".

If tokens carry no `email` claim at all, that is an API-side fix, not a frontend one — either add `email` as an optional access-token claim on the **API** app registration (Token configuration → Add optional claim → Access → `email`), or set `{SCOPE}__OIDC_EMAIL_CLAIM=preferred_username` on the API deployment. Tell the user which; don't work around it in the SPA.

### Code quality — the scaffolded code must teach

The generated code is the developer's first contact with the SDK and the API. Every file should make them feel like they already know how to extend it. This means:

**Comment every SDK call** — not what it does (they can read code), but *why* this pattern and *what else they could do*. Match the query syntax in these examples exactly — `orderBy` and `filter` are objects, not strings:

```ts
// Fetch cases for the logged-in user. client.me automatically scopes
// queries to records linked to the authenticated contact.
// Switch to client.team for account-wide access, or client.all for admin.
const cases = await client.me.list<Case>("case", {
  select: ["incidentid", "ticketnumber", "title", "statuscode"],
  orderBy: { field: "modifiedon", direction: "desc" },
  top: 50,
  // Add filters like this:
  // filter: { field: "statuscode", operator: "eq", value: 1 },
  //
  // Or combine multiple:
  // filter: { and: [
  //   { field: "prioritycode", operator: "eq", value: 1 },
  //   { field: "statecode", operator: "eq", value: 0 },
  // ]},
});
```

**Show the next move in comments** — every service function should hint at what the developer will want to do next:

```ts
export async function createCase(client: DataverseClient, input: Partial<Case>) {
  // Creates a case auto-bound to the caller's contact (via createDefaults
  // in the table schema). No need to set customerid manually.
  //
  // To attach a note after creating:
  //   await createCaseNote(client, { incidentid: result.incidentid, notetext: "..." });
  return client.me.create("case", input);
}
```

**Include working examples in hook files** — show loading, error, empty states, and refresh:

```ts
export function useCases() {
  const client = useDataverseClient();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCases(client);
      setCases(result.data);
    } catch (err) {
      // ApiError has .status and .message from the API response
      setError(err instanceof Error ? err.message : "Failed to load cases");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { refresh(); }, [refresh]);

  return { cases, loading, error, refresh };
}
```

**Components should be a starting point, not a dead end.** Include TODO comments that map out the obvious next features:

```tsx
// TODO: Add pagination — the SDK returns @odata.nextLink when there
//       are more results. Pass { top: 25 } and implement next/prev.
//
// TODO: Add inline status update — call updateCase(client, id, { statuscode: 5 })
//       then refresh(). The SDK handles the PATCH request.
//
// TODO: Add search — use the filter option:
//       filter: { field: "title", operator: "contains", value: searchTerm }
```

**Type files should document the shape** — explain what each field means and which are choice fields:

```ts
export interface Case {
  incidentid: string;
  ticketnumber: string;          // Auto-generated, e.g. "CAS-01234-X7Y8Z9"
  title: string;
  statuscode: number;            // Choice field — use statuscode_label for display
  statuscode_label?: string;     // e.g. "In Progress", "Resolved", "Cancelled"
  prioritycode: number;          // Choice: 1=High, 2=Normal, 3=Low
  prioritycode_label?: string;
  createdon: string;             // ISO 8601 datetime
  modifiedon: string;
  // Expanded from the contact lookup:
  customerid_contact?: {
    fullname: string;
    emailaddress1: string;
  };
}
```

The goal: a developer reads the generated code for 10 minutes and thinks "I know exactly how to add the next feature."

### SDK usage — the only acceptable pattern

```ts
// src/lib/client.ts — one client, memoised on getToken so hook deps stay stable.
import { createClient, type DataverseClient } from "@truenorth-it/dataverse-client";
import { useMemo } from "react";
import { API_BASE_URL, API_SCOPE } from "../env";
import { useAuth } from "../auth";

export function useDataverseClient(): DataverseClient {
  // getToken comes from AuthProvider — it wraps acquireTokenSilent and
  // escalates to a redirect when the IdP needs to see the user. Nothing here
  // touches MSAL directly, so swapping the IdP is a one-file change.
  const { getToken } = useAuth();
  return useMemo(
    () => createClient({ baseUrl: API_BASE_URL, scope: API_SCOPE, getToken }),
    [getToken],
  );
}

// src/services/caseApi.ts — read
import type { DataverseClient } from "@truenorth-it/dataverse-client";
import type { Case } from "../types/case";

export async function fetchCases(client: DataverseClient) {
  return client.me.list<Case>("case", {
    select: ["incidentid", "ticketnumber", "title", "statuscode"],
    orderBy: { field: "modifiedon", direction: "desc" },
    top: 100,
  });
}

export async function fetchCase(client: DataverseClient, id: string) {
  return client.me.get<Case>("case", id);
}

// src/services/casenoteApi.ts — fetch notes for a case
export async function fetchCaseNotes(client: DataverseClient, caseId: string) {
  return client.me.list<CaseNote>("casenotes", {
    filter: { field: "incidentid", operator: "eq", value: caseId },
    orderBy: { field: "createdon", direction: "desc" },
  });
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

`client.me` is the only tier with `create`. There is no DELETE on the data tier at all.

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

### 8. Environment — and the one thing you must ask for

Three of the five values come from step 0. The fourth is the user's.

**The SPA client ID is not discoverable, and this skill cannot create it.** Entra app registrations are made by hand in Azure — Terraform doesn't create them either, and there is no `contact-admin` command that will. So ask, in one message, and say exactly what you're asking for:

> I need the **client ID of the Entra app registration** for this portal — a GUID from your Entra External ID tenant.
>
> If one doesn't exist yet, it takes two minutes in the Azure portal: **App registrations → New registration**, then **Authentication → Add a platform → Single-page application** with `http://localhost:5173` as the redirect URI, then **API permissions → My APIs →** the API app → tick `access_as_user` → **Grant admin consent**. Full steps: `dataverse-contact-api/docs/SETUP-AUTH.md` §1b.
>
> Paste the Application (client) ID and I'll finish the wiring.

**The redirect URI must have no trailing slash.** `window.location.origin` never produces one, Entra compares the string exactly, and a mismatch is rejected at the IdP as `AADSTS50011` *before the app runs* — so nothing in the browser console explains it. Register `http://localhost:5173`, not `http://localhost:5173/`. Say this while asking; it is the single most common way this goes wrong.

It must also be added under the **Single-page application** platform, not Web. A Web-platform redirect URI on the same app fails the PKCE flow with a different, equally unhelpful error.

Then write `.env.example` and `.env` with every value filled in:

```
VITE_ENTRA_TENANT_ID=${TENANT_ID}                       # parsed from idp_issuer
VITE_ENTRA_CLIENT_ID=<the SPA app registration client ID the user gave you>
VITE_ENTRA_API_SCOPE=api://${IDP_AUDIENCE}/access_as_user
VITE_API_BASE_URL=${API_URL}                            # origin only — no trailing slash, no path
VITE_API_SCOPE=${TARGET_SCOPE}
```

Notes worth putting in `.env.example` as comments:

- `VITE_API_BASE_URL` is the **origin only**. The SDK builds every URL as `${base}/api/v2/${scope}${path}`, so a trailing slash or a `/api/v2` suffix produces doubled paths and 404s.
- Vite inlines `VITE_*` at **build time**. Changing them on a host without a redeploy does nothing — a real trap on Vercel, where the variable looks set and the bundle still carries the old value.
- Nothing here is secret. `clientId`, the authority, the API scope string and the API URL are all public and ship in the bundle by design.

**Production URL:** if the user names a prod URL (e.g. "deploy to Vercel later"), tell them to add that origin as a second SPA redirect URI on the same app registration before the first deploy. One registration serves localhost and production; `window.location.origin` picks the right one at runtime.

### 9. Run & verify

```bash
npm run typecheck   # must pass clean
npm run dev &       # background, report URL
```

**Port mismatch?** Vite picks the next free port if 5173 is taken (5174, 5175, …). If `npm run dev` reports anything other than 5173, sign-in will fail at Entra with `AADSTS50011` — and this skill cannot fix it for the user. Tell them plainly:

> Vite started on port `<actual-port>` instead of 5173. Add `http://localhost:<actual-port>` (no trailing slash) as a Single-page application redirect URI on app registration `<clientId>` in the Azure portal — Authentication → Single-page application → Add URI. Sign-in will fail with `AADSTS50011` until you do. Alternatively, stop whatever is on 5173 and restart.

### 10. Offer to grant the first user access

Identity comes from Entra; **authorisation comes from the API**, not from Entra roles or token claims. The scope's `defaults.json` gives every authenticated user with a Dataverse contact a baseline for free, and per-user escalations live in `cr_apipermission`.

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
   - Repeat for related tables (e.g. `casenotes` for case portals)
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

If the user wants team-tier or admin-tier access, expand the list accordingly (e.g. add `<table>:team` + `<table>:write:team`, or `<table>:all` + `<table>:write:all`).

Use the `access` family throughout. `contact-admin auth0 grant-access` still runs but is **deprecated** — it is a thin alias for `access grant`, and the rest of the `auth0` command family (`create-spa`, `list-spas`, `update-spa`, `sync-permissions`) only works on scopes still using the `auth0` provider. On an Entra deployment those commands do nothing useful.

If `access grant` returns `found: false`, there is no Dataverse **contact** with that email address. That is a Dataverse problem, not an Entra one: create the contact record (with `emailaddress1` set to exactly that address), then re-run. Signing the person up in Entra does not create a contact.

## Worked examples

### "build me a case portal using https://api.dataverse-contact.tnapps.co.uk"

- `API_URL` = provided; `TARGET_SCOPE` not specified.
- `.well-known` returns `idp_provider: entra-external-id` → Entra path, tenant parsed from `idp_issuer`.
- `contact-admin scopes list` returns: default, case-portal, ...
- Skill asks: "This API has scopes: default, case-portal. Use one of those, or create a new scope?"
- User: "default".
- `contact-admin login --scope default` — stores key.
- `contact-admin tables list` finds existing `incident` + `casenotes` — no setup-table needed.
- Scaffolds frontend, then asks for the SPA client ID. One prompt, one browser click, one GUID, done.

### "build me a bookings portal"

- `API_URL` = default; no scope in prompt.
- `contact-admin scopes list` returns: default.
- Skill asks: "Put this in `default` or create a new scope `bookings`?"
- User: "new scope called `bookings-pilot`".
- `contact-admin login --scope bookings-pilot` — scope auto-created on approval.
- `contact-admin setup-table msdyn_bookableresourcebooking` — scaffolds, saves, publishes.
- Scaffolds portal with `VITE_API_SCOPE=bookings-pilot`, so the SDK targets `/api/v2/bookings-pilot/`. The Entra API scope is unchanged — one `api://<api-app-id>/access_as_user` token is valid across every scope on the deployment that doesn't override the OIDC settings.

### "build me a case portal in scope case-portal"

- Scope explicitly named.
- `contact-admin login --scope case-portal` — scope auto-created on approval if it doesn't exist.
- For `incident`: `tables get case --scope default --json` returns the hand-curated schema. Copy it, publish to `case-portal`.
- For `casenotes`: `tables get casenotes --scope default --json` returns the hand-curated schema. Fix `lookupTable: "case"` → `"incident"` (the logical name — portable across scopes). Publish to `case-portal`.
- Do NOT also publish a generic `annotation` route — `casenotes` is the filtered alias that should be used.
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

## Failure modes worth recognising

| Symptom | Cause |
|---|---|
| `AADSTS50011` at the IdP, nothing in the browser console | the redirect URI isn't registered, or is registered with a trailing slash, or sits under the Web platform instead of Single-page application. Vite on a shifted port does this too |
| Blank white page, no error anywhere | something threw before React mounted — almost always an unset `VITE_ENTRA_*`. `assertEntraConfig()` must be called inside `bootstrap()`, and the catch must paint into `#root` |
| Every request 401s straight after a successful sign-in, fixed by a page reload | no active account — the `LOGIN_SUCCESS` event callback is missing |
| Signed-in user stuck on loading skeletons forever, every page | `acquireTokenSilent` timed out in a cookie-blocked iframe and only `InteractionRequiredAuthError` was caught |
| `401` from the API with a token that looks fine | issuer mismatch — decode at jwt.ms and compare `iss` to the API's `OIDC_ISSUER` |
| `404 "No Dataverse contact found"` on `/me` for a user who signed in fine | the token's email has no matching `contact.emailaddress1`. Render `NoContactNotice`, don't treat it as an error |
| `403` on a route that works for someone else | authenticated but lacks the permission. `contact-admin access show <email>`, then grant — and wait 5 minutes for the cache |
| Env change on Vercel with no effect | Vite inlined `VITE_*` at build time. Redeploy |

## Dependencies

This skill shells out via `Bash` for:
- `contact-admin` — all admin operations (auth, scopes, tables, access grants)
- `curl` — `/.well-known` discovery + choices endpoint
- `node -e` — JSON extraction from curl responses (portable; works on Git Bash, macOS, Linux)
- `sed` — parsing the tenant GUID out of `idp_issuer`
- `npm` / `npx` — scaffold and type-check

**Never use `jq`.** It isn't installed on Windows Git Bash or many corporate envs, and missing-command failures in mid-flow break the skill silently. Always reach for `node -e` when you need to parse JSON from a curl response.

The plugin's `.claude/settings.json` pre-approves these so the skill doesn't pause for permissions mid-flow.
