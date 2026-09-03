# preflight.mjs

The prerequisite check for the Dataverse Contact API help desk packs — and the
thing that writes the two `.env` files so you do not have to.

Getting the prerequisite values right is where most people stall, and two of the
ways to get them wrong produce a *working* app that shows nothing: no error, no
console message, just empty lists. This script gathers what it can, asks for
what it cannot, verifies all of it against the live API, and then writes the
files.

Node 20 or newer. Zero npm dependencies — `node:fs`, `node:path`,
`node:readline/promises` and the built-in `fetch`. It is read-only against the
API: nothing is published, changed or deleted.

## The eight values

| Value | Where it comes from |
|---|---|
| `DATAVERSE_CONTACT_API_URL` | **asked** (`--url`). Everything else hangs off it. Normalised to the origin — a trailing slash or an `/api/v2/...` path is stripped |
| `DATAVERSE_CONTACT_CONNECTION_KEY` | **asked** (`--key`, or `$DATAVERSE_CONTACT_CONNECTION_KEY`) |
| `SCOPE` | **asked** (`--scope`), default `helpdesk` |
| `VITE_ENTRA_TENANT_ID` | **discovered** — the GUID in the API's `idp_issuer` |
| `VITE_ENTRA_CLIENT_ID` | **asked** (`--spa-client-id`). Not discoverable: it is an app registration in your tenant, and the API has no idea which apps call it |
| `VITE_ENTRA_API_SCOPE` | **discovered** — `api://` + the API's `idp_audience` + `/access_as_user` |
| `VITE_API_BASE_URL` | same as the API URL |
| `VITE_API_SCOPE` | same as `SCOPE` |

Discovery reads `GET {url}/.well-known/oauth-protected-resource`, which is
public and unauthenticated — so `--check` tells you the tenant id and API scope
before you have a connection key in hand.

## Getting it

**If you have the plugin installed**, it came with it. Claude can run it for
you; on disk it is under the plugin cache:

```bash
ls ~/.claude/plugins/cache/*/dataverse-contact-api/*/skills/contact-api-reference/scripts/preflight.mjs
```

**If you do not use Claude Code plugins**, it is one file from a public repo:

```bash
curl -fsSL -o preflight.mjs \
  https://raw.githubusercontent.com/TrueNorthIT/claude-plugins/main/plugins/dataverse-contact-api/skills/contact-api-reference/scripts/preflight.mjs
node preflight.mjs --check
```

Run it from the root of the pack — the directory with `terraform/` and `app/`
side by side.

## Usage

```
node preflight.mjs [--url <api>] [--key <key>] [--scope <name>]
                   [--spa-client-id <guid>] [--out <dir>]
                   [--check] [--force] [--yes]
```

With no flags it prompts for the three values it cannot work out, showing each
discovered value as it goes.

| Flag | Meaning |
|---|---|
| `--url <api>` | Contact API base URL. Origin only — a path is stripped with a warning. Falls back to `$DATAVERSE_CONTACT_API_URL`, then prompts |
| `--key <key>` | Admin connection key. Falls back to `$DATAVERSE_CONTACT_CONNECTION_KEY`, then prompts (without echoing) |
| `--scope <name>` | API scope. Falls back to `$SCOPE`, then prompts. Default `helpdesk` |
| `--spa-client-id <guid>` | Application (client) ID of your SPA app registration. Validated as a GUID |
| `--out <dir>` | Pack directory holding `terraform/` and `app/`. Default `.` |
| `--check` | Run every check, write nothing. The "am I ready?" mode |
| `--force` | Overwrite an existing `.env`. Without it the script refuses, before prompting for anything |
| `--yes` | Never prompt. A missing required value fails with a message instead of hanging |
| `--help` | The flag list |

Exit code is `0` when every check passed, `1` when any failed. Checks that were
skipped (no key supplied) do not fail the run, but the summary says so — a run
with skips is not a clean bill of health.

`--out` expects the pack layout. If `terraform/` or `app/` are missing the
script says which, and offers to create them and write there anyway; under
`--yes` it goes ahead and says it did. If `--out` was simply wrong, the files
land somewhere the pack never reads them, so read that warning before answering.

## What each check proves

### 1. Is this a Contact API?

`GET /.well-known/oauth-protected-resource` returns 200 with an `idp_issuer`,
and `idp_provider` is an Entra family value. The tenant id and API scope are
read out of the same response.

**When it fails.** A connection error or a non-200 means the URL is wrong or the
host is not a Contact API. The document is public, so credentials are not the
problem — check the host name and that the deployment is up. If it answers but
`idp_provider` is something other than Entra, this pack cannot help you: the
app's sign-in code, the redirect-URI rules and the token shape all assume Entra
External ID.

Two details worth knowing, because they have both cost somebody a day:

- The response also carries `auth0_domain`, `auth0_issuer` and `auth0_audience`.
  They are **back-compat aliases** for older SDK versions. On an Entra
  deployment `auth0_domain` holds a `ciamlogin` URL — read them and you get an
  Entra tenant dressed up as an Auth0 one. The script reads only the `idp_*`
  fields.
- `idp_audience` may arrive as a bare GUID *or* as `api://<guid>`. Appending
  without checking gives `api://api://<guid>/access_as_user`, MSAL asks for a
  scope that does not exist, and nobody can sign in. That shipped once. The
  script strips any `api://` prefix first.

### 2. Is the admin connection key right?

`GET /api/v2/_admin/scopes` with `Authorization: Bearer <key>`. A `401` means
the key is wrong. Some deployments serve that endpoint unauthenticated — it
lists scope names and authorities, no secrets — so a 200 there proves nothing
on its own, and the script confirms the key against
`/api/v2/_admin/{scope}/table-definitions`, which always enforces it.

**When it fails.** The key must be **byte-identical** to `ADMIN_CONNECTION_KEY`
on the API deployment. A trailing newline from a copy-paste or a stray space is
enough for a 401. Copy it again rather than retyping it; the script strips
surrounding whitespace and tells you when it had to.

The key is a deployment-wide secret — one key administers every scope, and it
bypasses the Dataverse-role admin check entirely. It is never printed in full,
only masked as `abcd…wxyz`. Set `DATAVERSE_CONTACT_CONNECTION_KEY` in your
environment and it never has to be typed at all.

### 3. Does the scope exist yet?

Read from the same scope list.

**When it is absent, nothing is wrong.** Before the first `terraform apply` the
scope does not exist, and the script says so rather than failing.

What *does* need doing first is the scope's Dataverse connection, which is not
Terraform's to create. It lives as environment variables on the Contact API
deployment: `HELPDESK__DATAVERSE_URL`, `HELPDESK__AZURE_TENANT_ID`,
`HELPDESK__AZURE_CLIENT_ID`, `HELPDESK__AZURE_CLIENT_SECRET`. Until they are
set, the API silently falls back to the `default` scope's connection, the
publish validates your tables against the wrong Dataverse environment, and the
publish handler **deletes every field it cannot find there**. The API raises no
error; the apply fails instead with `Provider produced inconsistent result after
apply`, which says nothing about the real cause.

### 4. Is the scope's table config published?

`GET /api/v2/{scope}/schema` and look for the `case` route.

**When there are no routes**, the config has not been applied yet — normal, and
`terraform apply` will create it. Note that this endpoint answers 200 with an
empty table list for a scope that does not exist, so "empty" and "unknown scope"
look the same from outside.

**When there are routes but no `case`**, something is off: either the scope name
is wrong, or that scope belongs to a different application. The script prints
the route names it did find so you can tell which.

### 5. Does your sign-in account have a contact row?

This one cannot be checked without a user token, so the script prints the
command instead of running it. It is here because it is the failure that looks
like a bug in your code.

The API resolves the Dataverse contact from the token's lowercased `email`
claim, matched against `contact.emailaddress1`. Not the object id, not the
subject. An account whose email matches no contact row **authenticates
perfectly** and then 404s on every `/me` route — a working app showing nothing.

After signing in, take a token from DevTools → Network → any API call, and:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/v2/$SCOPE/me/whoami"
```

`"dataverseContact": null` means exactly that: authenticated fine, no contact
row. Fix it with a contact row whose `emailaddress1` matches the account's email
exactly, or sign in as somebody who already has one.

## What it writes

`<out>/terraform/.env` — the Terraform runner's credentials, sourced by
`run.sh`:

```
DATAVERSE_CONTACT_API_URL=
DATAVERSE_CONTACT_CONNECTION_KEY=
SCOPE=helpdesk
```

`<out>/app/.env` — the Vite build's configuration:

```
VITE_ENTRA_TENANT_ID=
VITE_ENTRA_CLIENT_ID=
VITE_ENTRA_API_SCOPE=api://<api-app-id>/access_as_user
VITE_API_BASE_URL=
VITE_API_SCOPE=helpdesk
```

Both files get a header saying when they were generated and that they are
gitignored — the packs' `.gitignore` files exclude `.env`, and the Terraform one
holds the admin key. Neither is overwritten without `--force`.

Every `VITE_*` value is inlined into the browser bundle at build time. Two
consequences: changing one on your host does nothing to a bundle that is already
built (rebuild and redeploy), and nothing secret can ever go in that file.

## After it passes

The script prints these as next steps, and the first one is the other
working-but-broken failure mode:

1. Register the redirect URIs on the SPA app registration under
   **Authentication → Single-page application** (not "Web" — a Web platform
   registration rejects the PKCE flow), character for character and with **no
   trailing slash**: `http://localhost:5175` and your deployment host. The app
   sends `window.location.origin`, which never ends in a slash, and Entra
   compares the string exactly. A registration of `http://localhost:5175/` dies
   at the identity provider with `AADSTS50011` before a line of the app runs —
   no error boundary, no console message, nothing to debug in the browser.
2. `cd terraform && bash run.sh plan`, then `apply`.
3. `cd app && npm install && npm run dev`.
4. Sign in and confirm the contact resolves — check 5 above.
