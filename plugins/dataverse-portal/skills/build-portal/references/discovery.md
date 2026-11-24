# Step 0 — discovering the deployment

_Part of the `build-portal` skill. Read it at step 0, before asking which scope. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

Two parallel calls (both public, no auth):

```bash
# Identity-provider config for the portal's .env
WELL_KNOWN=$(curl -s "${API_URL}/.well-known/oauth-protected-resource")
field() { echo "$WELL_KNOWN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d)['$1']??'')))"; }
IDP_PROVIDER=$(field idp_provider)
IDP_ISSUER=$(field idp_issuer)
IDP_AUDIENCE=$(field idp_audience)

# This skill only handles Entra External ID (CIAM). Everything below assumes a
# ciamlogin.com authority, so check the provider before parsing anything.
if [ "$IDP_PROVIDER" != "entra-external-id" ]; then
  echo "idp_provider is '$IDP_PROVIDER' — this skill only scaffolds Entra External ID portals." >&2
  exit 1
fi

# Entra External ID (CIAM) issuers are
# https://<tenantId>.ciamlogin.com/<tenantId>/v2.0 — the tenant GUID appears
# twice, so either occurrence will do.
TENANT_ID=$(echo "$IDP_ISSUER" | sed -E 's#^https://([^.]+)\.ciamlogin\.com/.*#\1#')

# sed passes non-matching input through UNCHANGED, so a workforce-Entra issuer
# (login.microsoftonline.com/<tid>/v2.0 — also reported as entra-external-id)
# leaves the whole URL in TENANT_ID, and the authority becomes
# https://https://login.microsoftonline.com/...ciamlogin.com/... — an app that
# builds, runs, and can never sign anyone in. Fail loudly here instead.
if ! [[ "$TENANT_ID" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "idp_issuer is not a ciamlogin.com CIAM issuer: $IDP_ISSUER" >&2
  exit 1
fi

# idp_audience may already be the full Application ID URI (api://<guid>) or a
# bare GUID, depending on how the deployment was configured. Strip any leading
# api:// before appending, or the scope ends up api://api://<guid>/…
ENTRA_API_SCOPE="api://${IDP_AUDIENCE#api://}/access_as_user"
```

```bash
# Existing scopes
contact-admin scopes list --url "${API_URL}" --json
```

Field map from `.well-known`:

| JSON field | What it is / where it goes |
|---|---|
| `idp_provider` | Which IdP the deployment uses. **Branch on this, together with `idp_issuer`.** `entra-external-id` **and** a `ciamlogin.com` issuer → everything below. Anything else stops the skill: `auth0`, `azure-b2c`, and `entra-external-id` on a workforce (`login.microsoftonline.com`) issuer all take a different authority shape. Tell the user this skill only scaffolds Entra External ID (CIAM) portals — the authority, `knownAuthorities` and tenant parsing below are all CIAM-shaped, and on any other issuer they produce an app that builds, runs, and signs nobody in. |
| `idp_issuer` | `https://<tenantId>.ciamlogin.com/<tenantId>/v2.0`. Parse the tenant GUID out of it → `VITE_ENTRA_TENANT_ID`. Guard the parse — see the shell above |
| `idp_audience` | The audience the API validates. Either a **bare GUID** or the full `api://<guid>` Application ID URI — the shipped onboarding Terraform sets the URI form. **Strip a leading `api://` before appending `/access_as_user`** → `VITE_ENTRA_API_SCOPE` |
| `resource` | Same value as `idp_audience`. Informational |
| `auth0_*` | **Ignore.** Backwards-compatibility aliases from before the Entra migration. On an Entra deployment `auth0_domain` holds a `ciamlogin.com` URL, so feeding it to an Auth0 SDK produces an app that builds, runs, and never signs anyone in. |

> **If any part of you wants to reach for `@auth0/auth0-react`, `Auth0Provider`,
> `useAuth0` or `VITE_AUTH0_*` while `idp_provider` says `entra-external-id`,
> stop and say so.** That combination means an out-of-date copy of this skill is
> installed — below 0.14.0 it scaffolded Auth0 — and it is the one failure that
> does not announce itself: the app builds, the dev server starts, sign-in
> redirects, and nobody can get in. Tell the user to run
> `claude plugin update dataverse-portal@truenorthit` and start this step again.
> Do not split the difference by wiring MSAL against `auth0_*` values.

There is exactly **one** coarse scope — `access_as_user`. No app roles, no per-permission scopes, no group claims. Everything about who may read or write what is decided inside the API from the scope's `defaults.json` plus `cpa_apipermission`; see step 10.

**Not in the discovery document: the SPA client ID.** It belongs to an app registration in the customer's Azure tenant and nothing on the API side knows about it. Step 8 asks the user for it. Nothing before then needs it, so don't ask yet.

Cache `TENANT_ID`, `IDP_AUDIENCE` and `ENTRA_API_SCOPE` for step 8.
