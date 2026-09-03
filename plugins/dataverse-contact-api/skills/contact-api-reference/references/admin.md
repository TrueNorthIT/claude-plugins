# The admin plane

`/api/v2/_admin/…` administers scopes, table definitions and permission grants.
Note the segment order: **`_admin` comes before the scope**, unlike every data
route.

## What counts as an admin credential

The admin middleware accepts three things, tried in this order:

| Order | Credential | Notes |
|---|---|---|
| 1 | `ADMIN_CONNECTION_KEY` | A pre-shared key, compared in constant time. It **short-circuits the role check entirely** — no Dataverse lookup happens. One key administers *every* scope on the deployment, so treat it as a deployment-wide secret |
| 2 | An MCP key | HMAC-signed and scope-bound. Role checks are deferred to the individual tool |
| 3 | A workforce Entra token | Validated, then matched to a `systemuser` and checked against that user's **Dataverse security roles** |

For the third, the qualifying roles are:

| Needed for | Roles |
|---|---|
| `admin:{scope}` — table management, defaults | System Customizer **or** System Administrator |
| Scope management itself | System Administrator only |

The role lookup is cached for 5 minutes and **fails closed** — if Dataverse
cannot be reached, the caller gets no roles rather than their last known ones.
A 403 immediately after granting someone a role is usually just that cache.

Because all three arrive as an ordinary `Authorization: Bearer …` header, option
3 works with a token you already know how to get:

```bash
TOKEN=$(az account get-access-token --resource "$DATAVERSE_URL" --query accessToken -o tsv)
curl -s -H "Authorization: Bearer $TOKEN" "$API_URL/api/v2/_admin/$SCOPE/table-manager/defaults"
```

That is the way in on a deployment where no pre-shared key is configured, or
where you would rather not handle one.

The connection key and the Entra route are **different credentials with
different tooling**: the Terraform provider uses the connection key only; the
`contact-admin` CLI uses workforce Entra. Neither can use the other's.

## Reading the effective permissions

```
GET /api/v2/_admin/{scope}/table-manager/defaults
```

Returns `{ "scope": …, "defaults": …, "effective": … }`. `defaults` is the
stored blob; `effective` is the deployment's filesystem baseline merged with it,
overlay winning per route. **When they differ, `effective` is what the API
applies** — start there when a grant is not behaving.

`PUT` to the same path replaces the stored defaults, with a body shaped like:

```json
{ "permissions": { "servicebooking": ["me", "create"] } }
```

It needs blob storage configured on the deployment; without it you get a 503
saying so. Prefer Terraform for this — a hand-edited `PUT` leaves no record of
what changed or why.

Listing the scopes needs nothing at all:

```bash
curl -s "$API_URL/api/v2/_admin/scopes"
```

It returns `{ scopes, scopeAuth }`, where each `scopeAuth` entry gives the
authority and API scope a client should use for that scope — the fastest way to
find out how to sign in to a deployment you have just been handed.

## The CLI

```bash
npm install -g @truenorth-it/contact-admin
contact-admin login          # device code against workforce Entra
```

| Command | Does |
|---|---|
| `whoami` | Who the CLI is authenticated as, and what it may administer |
| `scopes list` | The deployment's scopes |
| `tables list` / `get` | Published table definitions |
| `tables scaffold` | Generate a definition for a Dataverse entity |
| `tables publish` | Publish a definition to the scope |
| `tables test-query` | **Run a route's join for a given contact** — see below |
| `access grant` / `list` / `revoke` | Per-user `cr_apipermission` grants |
| `access defaults` / `show` | The scope's `defaults.json`, and the effective set |
| `setup-table <entity>` | End-to-end: discover an entity, scaffold it, publish it |

### `test-query` is the join debugger

```bash
contact-admin tables test-query <route> --tier me --contact-id <guid>
contact-admin tables test-query <route> --tier team --contact-id <guid>
```

It executes the configured join for a specific contact and shows what comes
back. This is how you verify a `contactJoinPath` or `teamJoinPath` **without a
portal, a browser or a sign-in** — the fastest way to settle whether an empty
`me` list is a join problem or genuinely no data. See `troubleshooting.md`.

## Forging a key for local testing

Against a deployment whose `MCP_KEY_SECRET` you know, `npm run forge-key` in the
API repo mints an HMAC key for a chosen identity.

**Identity is a test input; permissions are not.** A forged key lets you say
"treat this request as contact X" — it does **not** grant anything. Permissions
still resolve normally from the scope's `defaults.json` unioned with that
contact's `cr_apipermission` rows. So a forged key reproduces a real user's
access faithfully, which is the point, and cannot be used to escalate past it.

Local testing only, and only where you legitimately hold the secret.

## Related

Defining a scope's tables, joins and baseline permissions **as code** — rather
than through the CLI or Table Manager — is the `dataverse-terraform` plugin's
job. Prefer it for anything that should survive a rebuild or be reviewed in a
pull request. Use the CLI for discovery, one-off grants and diagnosis.
