# Checks

One entry per id the scanner reports. **Confirm** is what turns a candidate
into a finding; **Not a finding when** is the usual false positive; **Fix**
points at the pattern, most of them written out in `build-portal`'s
*Security — what the generated code must not do*.

## Data access

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `tier-all` | A citizen-facing flow reads or writes through `client.all` | A staff or admin tool whose users hold per-person `:all` grants. Code shown as text on a docs page is a softer finding: it teaches the pattern | `client.me` (or `team`). If `me` came back empty, fix the join or the contact; never widen the tier |
| `tier-team` | The page means the caller's colleagues' rows | It is a business portal and that is the point | — (informational) |
| `route-param` | A `useParams` id reaches `client.*.get` / `update`. The SDK puts it into the request path unencoded, with the user's token | The param is only used for display or local filtering | Check it is a GUID first, and render "not found" if not |
| `fetchpage-arg` | `fetchPage` is handed anything but the `page.next` the API returned (or a cursor derived from it) | The argument is `page.next` under another name — trace it | Pass `page.next` only. `fetchPage` sends the bearer token to any absolute URL |
| `fetchpage-append` | `fetchPage` is handed `page.next` with the portal's own query appended (`next + qs`, `` `${next}&select=…` ``) | The API is older than 1.24.0, whose `next` drops the query — and then the URL is rebuilt from the cursor each page, not appended to the last one | Pass `page.next` as returned. It already carries `select` / `filter` / `expand`; appending sent every parameter twice, and up to API 1.25.0 the URL grew each page until a `414 URI Too Long` |
| `public-invoke` | The custom API isn't `publicInvoke`, so this call 401s | It is meant to be anonymous and read-only | `client.me.invokeFunction` / `invokeAction` (SDK 1.24.0+), which send the token (build-portal, *SDK usage*). Never make an action public to suit the client |
| `company-key` | The portal switches company, and this key's data depends on the company | Identity-wide or public data: `whoami`, a public knowledge base | Put the selected company id in the key, or clear the cache on switch |
| `persisted-cache` | Query data is written to storage | — | Don't persist it. On a shared computer it is the previous person's data |

## SDK use

The SDK is how a portal stays on the API's current behaviour and catches a
wrong column name at compile time. None of these leak data on their own, except
`sdk-version`.

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `sdk-version` | The installed SDK is below 1.24.0. Those versions put a record id into the path unencoded and let `fetchPage` send the token to any absolute URL | — | `npm install @truenorth-it/dataverse-client@latest`, then `typecheck` |
| `sdk-behind` | A newer SDK is published (needs `--schema`, which allows network) | The project pins deliberately and says why | Upgrade to latest. Read the SDK README's changes for anything that moved |
| `no-generated-types` | No file from `dataverse-client generate`, so table types are hand-written or `Record<string, unknown>` | — | Add `"generate:types": "dataverse-client generate --url <api> --scope <scope> --output src/dataverse.generated.ts"`, run it, commit the output, and replace the hand-written interfaces with the generated ones |
| `no-generate-script` | The generated file exists but nothing regenerates it, so it drifts from the scope | It is regenerated in CI some other way | Add the `generate:types` script |
| `sdk-untyped` | A `list` / `get` / `create` / `update` call has no row type, so the result is untyped and a cast usually follows | Throwaway or diagnostic code | `list<Case>(…)` with `QueryOptionsFor<CaseField>`; writes take `CaseCreateInput` / `CaseUpdateInput` |
| `partial-write` | A write payload is `Partial<Row>`, so setting a read-only column compiles and the API drops it silently | The type is already narrowed to writable columns by hand. It still should be the generated input | `CaseCreateInput` / `CaseUpdateInput` from the generated file |
| `unpaged-list` | Nothing in the portal follows `page.next`, so each list shows its first page only: 20 rows by default, 100 at most, with no error past that | The table can't outgrow one page (a handful of reference rows) and `top` covers it — say so in a comment | `useInfiniteQuery` with `fetchPage(page.next)` and a "Load more" control (build-portal, *Code quality*); `eachPage` for a bounded export |
| `hand-fetch` | A Contact API route is called with `fetch` rather than the SDK | An anonymous `POST /public/{table}` on a `publicCreate` table, which the SDK has no method for | The SDK's tier client. It handles the token, the company header, query encoding and errors |

## Rendering

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `html-sink` | The value can come from the API — notes, email bodies, articles, any text field | It is built only from constants | `DOMPurify.sanitize`, in one `SafeHtml` component |
| `handmade-sanitizer` | Anything that strips tags by hand: a denylist misses dozens of vectors (case tricks, `<form>`, `<meta http-equiv>`, `<base>`, `style`) | — | Replace it with DOMPurify |
| `html-sanitised` | DOMPurify config allows `<form>` and `style` by default | Content comes from trusted staff authors | Consider `FORBID_TAGS: ["form", "style"]` |
| `html-static` | — | Always: a static string | — (informational) |
| `href-from-data` | The URL comes from a field (a website, a link column). React < 19 only warns on `javascript:` | It is built from a constant prefix plus an id | `safeHref`: allow `https:`, `mailto:`, `tel:` only |
| `redirect-param` | A post-login destination is read from the query string and navigated to | It is checked to be a same-origin relative path | Accept only paths starting with a single `/`; otherwise go home |

## Secrets and environment

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `vite-secret` | A `VITE_*` variable holds a key, password, connection string or token | It is empty, or a placeholder in `.env.example` | Move it server-side. If it ever shipped, **rotate it** |
| `bundle-secret` | The value is in `dist/` (the scanner checked) | — | Rotate the secret, then remove it from the browser build |
| `vite-key` | The key is not publishable | A key designed to be public: map tiles, analytics site ids | — |
| `demo-token-file` | `VITE_DEMO_TOKEN` is in `.env`, `.env.local` or `.env.production*` | — | `.env.development.local` only (the dev server loads it, `vite build` doesn't), and gate the code on `import.meta.env.DEV` |
| `dynamic-env` | `import.meta.env[name]`, or a spread / `Object.keys` of it | — | Read each variable by name. A dynamic read inlines every `VITE_*` variable, used or not |
| `env-tracked` | A real `.env` file is committed | It holds only public values and is meant to be committed | `git rm --cached`, add it to `.gitignore`, rotate anything secret it ever held |
| `gitignore-env`, `gitignore-local` | `.env` / `.env.*.local` aren't ignored | — | Add `.env`, `.env.*` and `!.env.example` |

## Sign-in and session

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `msal-local-storage` | MSAL caches tokens in `localStorage` | — | `sessionStorage`. The tab's tokens end with the tab; MSAL v5's `localStorage` encryption doesn't stop injected script |
| `no-logout` | Nothing calls `logoutRedirect` | Sign-out lives in a shared package — find it | A sign-out control on every page. It is the only thing that ends the identity provider's session on a shared PC |
| `msal-popup` | Popups are used for sign-in or tokens | — | Redirect flows |
| `token-log` | A token or `Authorization` header is logged | — | Remove it; logs end up in error trackers |
| `token-storage` | A token is written to web storage by hand | A third-party service token by its own design (scope it tightly) | Let MSAL own tokens |
| `token-in-url` | An Entra token goes in a URL | A Web PubSub / SignalR client token, by that service's design — but check *where* it was minted: a token signed in the browser means the access key is in the browser | Mint service tokens server-side |

## What citizens see

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `raw-error` | The API's `message` reaches a citizen's screen. It names permissions and echoes input (and on deployments before API 1.24.0, Dataverse's raw error) | Developer-only pages and admin tools | `friendlyError(err)` by status; log the original with its correlation id; keep `NoContactNotice` for the no-contact 404 |
| `email-gate` | UI is shown or hidden by comparing an email address | It only hides links whose destinations need their own sign-in — still say it is cosmetic | Real staff features belong in a separate app, granted per person |
| `debug-switch` | A `localStorage` flag turns on diagnostics | What it reveals is harmless | Build-time flag, or nothing in production |
| `analytics` | Analytics or session replay loads before consent, or on signed-in pages without masking | Consent-gated, masked, and nothing personal is sent | Load after consent; mask personal fields; no session replay on signed-in pages |
| `analytics-identify` | An email address is sent to the service | — | An opaque id, never an email address |

## Headers and platform

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `no-csp` | Neither the repo nor the edge sets a Content-Security-Policy | It is set at the edge (Front Door, a gateway) — ask, or check the deployed response headers | The CSP in build-portal's `references/security.md` |
| `no-frame-protection` | No `frame-ancestors` / `X-Frame-Options` | Set at the edge | `frame-ancestors 'none'` |
| `react-version` | React < 19 | — | Upgrade, or `safeHref` on every data-driven link |

## The scope (`--schema`)

These belong to the scope's config, not the portal. Report them and name the
owner: Terraform (the `dataverse-terraform` plugin) or the Table Manager.

| id | Confirm | Not a finding when | Fix |
|---|---|---|---|
| `schema-email-writable` | The contact route lets callers write `emailaddress1` — the column the API matches sign-ins to | — | `readOnly`. Changing a citizen's address is a staff and identity-provider job |
| `schema-company-link-writable` | `parentcustomerid` is writable — it decides whose team rows the caller sees | — | `readOnly` |
| `schema-createdefault-writable` | A field bound by `createDefaults` is writable, so it can be re-pointed after create | — | `readOnly`; the default still binds it on create |
| `schema-lookup-unchecked` | A writable lookup has no `lookupTable`, so writes aren't checked against the caller's rows | — | `readOnly`, or a `lookupTable` naming a published route |
| `schema-status-writable` | Citizens can set status or priority | The portal really does let them, deliberately | `readOnly`; let staff own triage |
| `schema-empty-default-select` | The default select is empty, which the API treats as no projection | — | List the columns |
| `schema-expand-no-fields` | An expand lists no fields | — | List them, and only ones anyone who can read the parent may see |
| `schema-public-read` | Every column in `fields` is public, not just the default select | The route is meant to be public and its fields are all publishable | Trim `fields`; rate-limit at the edge |

The schema shows neither `publicCreate`, `fetchXml` nor the scope's defaults.
Those need the Terraform config (read it with the `dataverse-terraform`
plugin's security pass) or an admin credential.
