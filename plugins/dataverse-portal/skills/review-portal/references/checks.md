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
| `public-invoke` | The custom API isn't `publicInvoke`, so this call 401s | It is meant to be anonymous and read-only | `fetch` with the bearer token (build-portal, *SDK usage*). Never make an action public to suit the SDK |
| `company-key` | The portal switches company, and this key's data depends on the company | Identity-wide or public data: `whoami`, a public knowledge base | Put the selected company id in the key, or clear the cache on switch |
| `persisted-cache` | Query data is written to storage | — | Don't persist it. On a shared computer it is the previous person's data |

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
| `raw-error` | The API's `message` reaches a citizen's screen. It can carry Dataverse's raw error and echo input | Developer-only pages and admin tools | `friendlyError(err)` by status; log the original; keep `NoContactNotice` for the no-contact 404 |
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
