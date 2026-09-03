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
  "idp_provider": "entra-external-id",
  "idp_issuer": "https://<tenant>.ciamlogin.com/<tenant>/v2.0",
  "idp_audience": "<api-app-guid>"
}
```

Read the `idp_*` fields. They are provider-neutral and are the ones that will
keep working. The response may also carry `auth0_*` fields — those exist purely
for backwards compatibility with older clients and should not be used in new
work.

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
| 1 | whatever `OIDC_EMAIL_CLAIM` names | if configured on the deployment |
| 2 | `email` | |
| 3 | `preferred_username` | **only if it contains `@`** — CIAM sometimes puts a non-email username here |
| 4 | `emails[]` | first entry |

### The consequence: a valid token with no contact

If no contact matches, the token still authenticates. You get a session, a
`sub`, and a resolved permission list — and then:

| Route | Result |
|---|---|
| `/{scope}/me/...` | **404** — there is no contact to join from |
| `/{scope}/team/...` | **404** — same |
| `/{scope}/all/...` | works — `all` applies no join, so it tolerates a missing contact |
| `/{scope}/me/whoami` | **200**, with `dataverseContact: null` |

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

```json
{
  "identity": {
    "sub": "…",
    "email": "someone@example.com",
    "permissions": ["case", "case:team", "case:write", "case:create"]
  },
  "dataverseContact": { "contactid": "…", "fullname": "…", "emailaddress1": "…" },
  "companies": [ { … } ],
  "hasMultipleCompanies": false
}
```

`whoami` is deliberately tolerant — it is a diagnostic, so it answers 200
wherever it possibly can. A 401 here means the token itself is bad (wrong
audience, wrong issuer, expired, malformed). A 200 with `dataverseContact:
null` means the token is fine and the contact lookup failed. Those are entirely
different fixes.

## Multiple companies

A contact can be associated with more than one company; `hasMultipleCompanies`
tells you whether the UI needs a company switcher. The active company changes
what `team` returns. In the SDK this is `withCompany()` — see `sdk.md`.

## The public tier needs no token at all

`/{scope}/public/{table}` is unauthenticated and read-only, available only for
tables published with `publicRead: true`. Use it for genuinely open reference
data — service catalogues, opening times. Never reach for it to sidestep an
auth problem: it exposes those rows to the entire internet.
