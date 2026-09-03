# The route surface

Everything the API serves, what it needs, and what it gives back. The common
data routes are in `SKILL.md`; this file is the rest, plus the response
contract.

## Data routes

Base: `/api/v2/{scope}/{tier}/…` where `{tier}` is `me`, `team`, `all` or
`public`.

| Route | Verbs | Notes |
|---|---|---|
| `/{table}` | `GET`, `POST` | `POST` on any tier but `me` is a **405** |
| `/{table}/{id}` | `GET`, `PATCH` | No `DELETE` — the handler does not implement one |
| `/lookup/{table}?search=` | `GET` | Type-ahead. Returns a trimmed shape for pickers, not full rows |
| `/aggregate/{table}?aggregate=count&groupBy=` | `GET` | Counts by a grouping field |
| `/changes/{table}?deltaToken=` | `GET` | Delta query, on routes with change tracking published |
| `/public/actions/{name}[/{id}]` | `GET`, `POST` | Named actions, where the scope publishes them (the `invoke` permission) |

The `public` tier serves list, single record and actions only.

### Why there is no delete

The record handler allows `GET` and `PATCH`; the list handler allows `GET` and
`POST`. That is the whole matrix. Citizen-facing deletion of a Dataverse row is
not something the API is willing to do.

Deactivation is a write to `statecode`:

```http
PATCH /api/v2/default/me/case/{id}
{ "statecode": 1 }
```

**`incident` is the exception.** Dataverse rejects a plain `statecode` PATCH on
a case; closing one requires the `CloseIncident` action, which also needs a
resolution record. Do not design a "close my case" button as a `statecode`
update and expect it to work.

A wrong verb comes back as:

```json
{ "error": "Method Not Allowed", "message": "Method not allowed", "statusCode": 405 }
```

with `Access-Control-Allow-Methods` naming what the route does accept — read
that header rather than guessing.

Two more 405 messages are worth recognising, because they are about the *route*
rather than the verb: `Public access is read-only`, and `Lake-backed tables are
read-only` on a route served from the data lake.

## Scope-level routes

| Route | Verb | Auth | Returns |
|---|---|---|---|
| `/{scope}/me/whoami` | `GET` | valid token | identity, contact, companies |
| `/{scope}/me/companies` | `GET` | valid token | `{ companies, hasMultiple }` |
| `/{scope}/me/claimable-companies` | `GET` | valid token | companies the caller could link to |
| `/{scope}/me/register` | `POST` | valid token | self-registration, where the scope enables it |
| `/{scope}/schema[?table=]` | `GET` | **none** | published tables, or one table's fields |
| `/{scope}/openapi.json` | `GET` | none | OpenAPI document for the scope |
| `/{scope}/choices[/{table}[/{field}]]` | `GET` | see below | option sets |
| `/{scope}/negotiate` | `POST` | valid token | SignalR connection details |
| `/{scope}/mcp` | `POST` | token | MCP endpoint |
| `/{scope}/mcp-keys` | `POST` | token | mint an MCP key |

`schema` needs no credentials, which makes it the right readiness probe and the
right way to discover field names before writing a query.

### whoami

```json
{
  "identity": {
    "sub": "…",
    "email": "someone@example.com",
    "permissions": ["case", "case:team", "case:write"]
  },
  "dataverseContact": {
    "contactid": "…",
    "emailaddress1": "…",
    "fullname": "…",
    "accountid": "…",
    "companyName": "…"
  },
  "companies": [
    {
      "companyId": "…", "contactid": "…", "accountId": "…",
      "companyName": "…", "fullname": "…",
      "isDefault": false, "isCurrent": true
    }
  ],
  "hasMultipleCompanies": false
}
```

`dataverseContact` is `null` when no contact matched the email claim, and
`identity.email` is absent when the token carried no email claim at all — the
call still returns 200 in both cases. This is intentional: `whoami` is a
diagnostic and answers wherever it can. See `troubleshooting.md`.

### choices

Three shapes, depending on how specific you are:

```jsonc
// /{scope}/choices
{ "tables": [ { "table": "case", "fields": { "statuscode": [ … ] } } ] }

// /{scope}/choices/{table}
{ "table": "case", "fields": { "statuscode": [ { "value": 1, "label": "In Progress" } ] } }

// /{scope}/choices/{table}/{field}
{ "table": "case", "field": "statuscode", "choices": [ { "value": 1, "label": "In Progress" } ] }
```

Most routes publish their choices openly, so no permission is needed. A route
that does not requires *any* permission on the subject, and otherwise answers
`403 No permissions for table '<route>'. Requires any permission for this
table.`

Asking for a non-choice field is a 404 that says so, naming the field's actual
type — useful when you are not sure whether something is a choice or a lookup.

## Tier availability is per route

A route only serves `me` if it declares a contact join path, and only serves
`team` if it declares a team join path. Ask for a tier it does not support and
you get a **404**, not a 403:

```
Table "servicecatalogue" does not support /me access. Use /all/servicecatalogue instead.
```

The message names the tier that will work. This is a configuration fact about
the route, not anything to do with your permissions — no grant will change it.

## Admin routes

Note the segment order — `_admin` comes **before** the scope, unlike everything
else:

| Route | Verbs | Auth |
|---|---|---|
| `/api/v2/_admin/scopes` | `GET` | **none** — public. Returns `{ scopes, scopeAuth }` |
| `/api/v2/_admin/{scope}/table-manager/defaults` | `GET`, `PUT` | `admin:{scope}` |
| `/api/v2/_admin/{scope}/table-manager/{table}` | `GET`, `PUT`, `DELETE` | `admin:{scope}` |
| `/api/v2/_admin/{scope}/table-manager/{publish\|unpublish\|remove\|drafts\|recycled\|validate\|reset}` | mixed | `admin:{scope}` |
| `/api/v2/_admin/{scope}/table-definitions` | `GET` | admin credential |
| `/api/v2/_admin/{scope}/discover` | `GET` | admin credential |
| `/api/v2/_admin/{scope}/custom-api-*` | mixed | `admin:{scope}` |

`table-manager/defaults` returns `{ "scope": …, "defaults": …, "effective": … }`
— `defaults` is the stored blob, `effective` is the filesystem baseline merged
with it. **When they disagree, `effective` is what the API will apply.**

Admin credentials are covered in `admin.md`.

## Response headers

| Header | Meaning |
|---|---|
| `x-correlation-id` | On **every** response. Capture it — it is what support needs to find your request in the logs |
| `X-Cache: HIT` / `MISS` | Present **only when the response cache is enabled**, which it is not by default. A `HIT` explains a stale read |
| `X-Data-Source: lake` | The read was served from the data lake rather than live Dataverse. Lake rows carry no `_label` enrichment and are read-only |
| `X-Deprecated-Field` | Format `old=>new`, comma-separated (e.g. `_objectid_value=>incidentid`). Not an error today; fix it before it becomes one |

The first three are listed in `Access-Control-Expose-Headers`, so a browser
client can actually read them.

## Operational endpoints

`/health` and `/cache-stats` exist **only on the container deployment**. They
are not in the serverless route table at all, so a monitor pointed at `/health`
will report a perfectly healthy Vercel deployment as down.

Use `GET /api/v2/{scope}/schema` as the universal readiness probe: it needs no
credentials, exists on every deployment, and a 200 additionally proves the
scope's configuration loaded — which a generic health check would not tell you.
