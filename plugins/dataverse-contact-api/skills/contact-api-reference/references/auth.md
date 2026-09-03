# Authentication

Sign-in is **Microsoft Entra External ID** (CIAM). The API validates a bearer
token, extracts an email claim, and resolves that to a Dataverse contact. Every
authorisation decision after that is internal to the API — see
`permissions.md`.

## Discover the settings, do not hard-code them

Each scope publishes its own IdP configuration. Ask the deployment rather than
copying values between environments:

```
GET {API_URL}/.well-known/oauth-protected-resource
```

```json
{
  "resource": "https://api.dataverse-contact.tnapps.co.uk",
  "authorization_servers": ["https://<tenant>.ciamlogin.com/<tenant>/v2.0"],
  "bearer_methods_supported": ["header"],
  "idp_provider": "entra-external-id",
  "idp_issuer": "https://<tenant>.ciamlogin.com/<tenant>/v2.0",
  "idp_audience": "<api-app-guid>",
  "auth0_domain": "…", "auth0_issuer": "…", "auth0_audience": "…"
}
```

Read the `idp_*` fields. They are provider-neutral and are the ones that will
keep working. The `auth0_*` fields are still emitted, but purely for
backwards compatibility with older clients — they carry the same values and
should not be used in new work. The response is cached for a day.

There is a matching `/.well-known/oauth-protected-resource/_admin` for the admin
plane, which is a **different audience and a different token**. Do not point a
citizen-facing client at it.

## MSAL configuration

| Setting | Value |
|---|---|
| Authority | `https://<tenant>.ciamlogin.com/<tenant>` |
| `knownAuthorities` | `["<tenant>.ciamlogin.com"]` — **required**, MSAL will not trust a CIAM authority without it |
| Scope requested | `api://<api-app-id>/access_as_user` |
| Audience the API expects | `idp_audience` from discovery |

There is **one coarse OAuth scope**: `access_as_user`. There are no app roles,
no per-permission scopes and no group claims. Do not attempt to model portal
permissions as Entra scopes — the API will not look at them, and requesting a
scope it does not know about fails at the IdP.

### Redirect URIs must not have a trailing slash

`https://portal.example.com/callback` — not `.../callback/`. A mismatch fails
at the IdP with:

```
AADSTS50011: The redirect URI specified in the request does not match …
```

This happens **before your application code runs**, so there is nothing to
debug in the app. If sign-in dies at the Microsoft page rather than coming back
to your callback, check for a stray slash first — the app registration and the
MSAL config must agree byte for byte.

## Contact resolution — by email, not by object id

The API matches the caller to a Dataverse row by comparing the **lowercased
email claim** against `contact.emailaddress1`.

It is **not** `oid` and **not** `sub`. Those are stable identifiers and would be
the obvious choice, but the contacts already exist in Dataverse with no Entra
identifier on them, so email is the join.

The claim is taken in this order, first match wins:

| Order | Claim | Condition |
|---|---|---|
| 1 | whatever `{SCOPE}__OIDC_EMAIL_CLAIM` names | if configured for that scope on the deployment |
| 2 | `email` | |
| 3 | `preferred_username` | **only if it contains `@`** — CIAM sometimes puts a non-email username here |
| 4 | `emails[]` | first entry |

The result is lowercased before the comparison, so case in either the token or
the contact record is irrelevant. A token carrying none of these is a 401:

```
Token does not contain an email claim. Ensure the identity provider includes
the email in access tokens.
```

That is a claims-mapping problem in the app registration, not an API problem.

### The consequence: a valid token with no contact

If no contact matches, the token still authenticates. You get a session, a
`sub`, and a resolved permission list — and then:

| Route | Result |
|---|---|
| `/{scope}/me/...` | **404** `No Dataverse contact found for your account.` |
| `/{scope}/team/...` | **404** — same |
| `/{scope}/all/...` | works — `all` applies no join, so it tolerates a missing contact |
| `/{scope}/me/whoami` | **200**, with `dataverseContact: null` |

(A `POST` to create is the one place this surfaces as a 401 rather than a 404:
`Could not resolve contact for authenticated user`. Same cause.)

This is the failure that looks most like a bug and is least like one. The user
signed in successfully, so the client shows them as logged in, and then every
page is empty or 404. `whoami` names the cause in one call.

Common causes: the contact's `emailaddress1` differs from the sign-in address
(a work alias, a changed surname, a typo), or the contact simply has not been
created yet. Self-registration, where a scope enables it, exists to close that
gap — see `sdk.md` for `me.register()`.

## Checking a token

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/v2/$SCOPE/me/whoami" | jq
```

The full response shape is in `routes.md`. `whoami` is deliberately tolerant —
it is a diagnostic, so it answers 200 wherever it possibly can:

| Result | Means |
|---|---|
| `401 Missing or malformed Authorization header` | No `Bearer` token reached the API |
| `401 Token has expired` / `Invalid token` / `Token validation failed: …` | The token itself is wrong — audience, issuer, signature, or expiry |
| `200` with `dataverseContact: null` | The token is fine; no contact matched the email |
| `200` with a contact | Auth is not your problem. Read `identity.permissions` next |

A 401 and a 200-with-null are entirely different fixes: one is app registration,
the other is data.

## Multiple companies

A contact can be associated with more than one company; `hasMultipleCompanies`
tells you whether the UI needs a company switcher. The active company changes
what `team` returns, and is selected with the `X-Company-Id` request header. In
the SDK this is `withCompany()` — see `sdk.md`.

When `team` cannot work out which company applies, the 404 says so explicitly:

```
No company account is available for team access. In the parent-account model
your contact must belong to an account (parentcustomerid); in the
associated-accounts model you must select a linked company (X-Company-Id).
```

That message names both models and tells you which input is missing — read it
rather than assuming the permission is wrong.

## The public tier needs no token at all

`/{scope}/public/{table}` is unauthenticated and read-only, available only for
tables published with `publicRead: true`. Use it for genuinely open reference
data — service catalogues, opening times. Never reach for it to sidestep an
auth problem: it exposes those rows to the entire internet.
