# Before anyone else uses the portal

Two jobs for after the portal works and before it reaches real people: send the
response headers below, and run the go-live checks. Neither changes the code the
skill generated.

## Response headers

A portal on the house stack is static files, so these go in the host's
response-header configuration, or in the reverse proxy in front of it. They are
what makes an HTML-injection bug a non-event instead of a stolen session.

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<api-host> https://<tenant-id>.ciamlogin.com; frame-src 'self' https://<tenant-id>.ciamlogin.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

| Directive | Why it is there |
|---|---|
| `script-src 'self'` | The point of the policy. Script injected through a data field can't run, and can't load more script |
| `connect-src` | The API, and MSAL's metadata and token calls to the CIAM authority. Anything else the page calls goes here too — a SignalR or Web PubSub endpoint (`wss://…`), a map tile server |
| `frame-src` | MSAL's fallback renewal runs in a hidden iframe: it loads the authority, then redirects back to the portal's own origin inside the frame — hence `'self'` as well |
| `frame-ancestors 'none'` | No other site can frame the portal and steer a citizen's clicks |
| `form-action 'self'` | An injected `<form>` can't post what the citizen types somewhere else |
| `base-uri 'self'`, `object-src 'none'` | Close two older ways of changing where script loads from |

Filling it in:

- `<api-host>` is the host of `VITE_API_BASE_URL`; `<tenant-id>` is
  `VITE_ENTRA_TENANT_ID`. A tenant on a custom sign-in domain uses that host
  instead of `ciamlogin.com`.
- Add the origins of anything else the page loads: web fonts
  (`style-src https://fonts.googleapis.com` and
  `font-src https://fonts.gstatic.com`), analytics, maps. If the console shows a
  blocked request to `login.microsoftonline.com`, add that to `connect-src`.
- The Vite dev server injects inline script for hot reload, so send the policy
  on production responses only.
- Roll it out as `Content-Security-Policy-Report-Only` first. The browser
  reports what it would have blocked, and blocks nothing.

**Verify it:** deploy, sign in, visit every page, then leave a tab open past the
access token's lifetime (about an hour) so a silent renewal runs. Every
`Refused to …` line in the console is a directive to fix before switching from
report-only to enforcing. That hour exercises the usual renewal, a refresh-token
call under `connect-src`. The iframe under `frame-src` is the fallback once the
refresh token itself expires, after about 24 hours — which is why both
directives are in the policy even if the first hour never touches the second.

## Go-live checks

| Check | How |
|---|---|
| Each route keeps strangers out | `contact-admin tables test-query <route> --tier me --contact-id <a GUID matching nobody>` returns 0 rows, for every `me` route — and `--tier team --account-id <a GUID matching no account>` for every `team` route |
| One citizen can't open another's record | Signed in as B, open the URL of A's record: "not found" |
| The baseline has no unscoped grants | `contact-admin access defaults` lists no `all` and no action ending in `:all` |
| Identity and status columns are read-only | `contact-admin tables get <route>`: `emailaddress1`, the company link, status, priority, owner, and every field a `createDefaults` entry binds show `readOnly: true` |
| No secret in the bundle | `npm run build`, then `grep -rl "<first dozen characters of the value>" dist/` for every key or token that has ever been in a `.env*` file. Expect no output |
| No raw HTML | `dangerouslySetInnerHTML` appears only in the DOMPurify wrapper; links built from data go through the scheme check |
| Errors are written for citizens | Force a 403 and a 500: the screen shows friendly text, not the API's message |
| Shared devices | Sign-out (`logoutRedirect`, which also ends the identity provider's session) is reachable from every page and lands on a signed-out screen; `cacheLocation` is `sessionStorage` |
| The app registration | The one production uses: Single-page application platform only, implicit grant off, exact redirect URIs, no `localhost` |
| Headers | As above, with no `Refused to …` in the console after an hour of use |
| Analytics | Nothing on signed-in pages before consent; no email address sent as an identifier |
| Public routes | If the scope has `publicRead` or `publicCreate` routes, they sit behind rate limiting at the edge |

When a check fails and the reason isn't obvious, the `dataverse-contact-api`
plugin's `references/security.md` sets out what the API enforces, what it takes
on trust from the scope, and what it leaves to the client.
