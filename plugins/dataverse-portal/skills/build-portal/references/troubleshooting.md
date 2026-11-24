# Failure modes worth recognising

_Part of the `build-portal` skill. Read it at steps 5 and 9, or whenever sign-in, a request or a build fails. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

| Symptom | Cause |
|---|---|
| `AADSTS50011` at the IdP, nothing in the browser console | the redirect URI isn't registered, or is registered with a trailing slash, or sits under the Web platform instead of Single-page application. Vite on a shifted port does this too |
| Blank white page, no error anywhere | something threw before React mounted — almost always an unset `VITE_ENTRA_*`. `assertEntraConfig()` must be called inside `bootstrap()`, and the catch must paint into `#root` |
| Every request 401s straight after a successful sign-in, fixed by a page reload | no active account — the `LOGIN_SUCCESS` event callback is missing |
| Signed-in user stuck on loading skeletons forever, every page | `acquireTokenSilent` timed out in a cookie-blocked iframe and only `InteractionRequiredAuthError` was caught |
| `401` from the API with a token that looks fine | issuer mismatch — decode at jwt.ms and compare `iss` to the API's `OIDC_ISSUER` |
| `404 "No Dataverse contact found"` on `/me` for a user who signed in fine | the token's email has no matching `contact.emailaddress1`. Render `NoContactNotice`, don't treat it as an error |
| `403` on a route that works for someone else | authenticated but lacks the permission. `contact-admin access show <email>`, then grant — and wait 5 minutes for the cache |
| `403` on every route, for everyone, on a scope created in this session | it has no published baseline, so it grants nothing — which is correct until someone decides what the baseline is (step 10). Don't paper over it with `all` |
| A write returns 200 but a field never changes | the field is `readOnly` in the schema; the API drops it silently rather than erroring |
| The `test-query` with a contact id that matches nobody returns rows | the route isn't filtering by caller — usually a FetchXML template without `{{contactid}}`, which replaces the join path. Fix it before anyone signs in |
| On a shared PC the next person lands in the last person's session | nobody signed out. Closing the tab doesn't end the identity provider's session; only `logoutRedirect` does. Keep sign-out one click away, and use `sessionStorage` so the app's own tokens end with the tab |
| Env change on Vercel with no effect | Vite inlined `VITE_*` at build time. Redeploy |
| `typecheck` fails with a field name the API definitely has | `dataverse.generated.ts` is older than the scope. `npm run generate:types` and commit the diff |
| `generate:types` fails with `ENOENT` on the output path | `generate` won't create directories. The output path must sit in a folder that exists (`src/`) |
| `TS2345 … Index signature for type 'string' is missing` on `create` / `update` | SDK 1.24.2 or older rejects a generated `CreateInput` interface. Upgrade to latest (1.25.0+) |
| A list shows exactly 20 (or 100) rows and nothing past them | It calls `list` once. That is one page: 20 by default, 100 at most. Page with `useInfiniteQuery` + `fetchPage(page.next)` |
