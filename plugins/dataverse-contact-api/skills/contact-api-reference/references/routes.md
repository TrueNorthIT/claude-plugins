# The route surface

Everything the API serves, what it needs, and what it gives back. The common
data routes are in `SKILL.md`; this file is the rest, plus the response
contract.

## Data routes

Base: `/api/v2/{scope}/{tier}/…` where `{tier}` is `me`, `team`, `all` or
`public`.

| Route | Verbs | Notes |
|---|---|---|
| `/{table}` | `GET`, `POST` | `POST` is `me`-only, **plus** `public` on a table that sets `publicCreate`. `team` and `all` are always a 405 |
| `/{table}/{id}` | `GET`, `PATCH` | No `DELETE` — the handler does not implement one |
| `/lookup/{table}?search=` | `GET` | Type-ahead. Returns a trimmed shape for pickers, not full rows |
| `/aggregate/{table}?aggregate=count&groupBy=` | `GET` | Counts by a grouping field |
| `/changes/{table}?deltaToken=` | `GET` | Delta query, on routes with change tracking published |
| `/actions/{name}[/{id}]` | `GET`, `POST` | Custom APIs, on the tiers each API lists. See below |

The `public` tier serves list, single record and actions only — no lookup, no
aggregate, no changes.

### `public` is read-only, with one opt-in

A table that sets `publicCreate: true` accepts an **unauthenticated**
`POST /public/{table}`. No token, no contact resolution, no permission check —
the handler skips the whole auth pipeline for that one case. It is a deliberate
per-table decision (`public_create` in Terraform, `publicCreate` in a schema
definition), and it should be set only on tables whose rows anyone on the
internet may create.

With no caller, nothing caller-shaped applies: `createDefaults` bind nothing,
and lookup values are not checked against anyone's rows. The anonymous caller
sets every writable field, lookups included, and the 201 echoes the row through
`defaultSelect`. It does not require `publicRead`, and the API does no rate
limiting of its own — see `security.md`.

Everywhere else `public` writes are a 405 `Public access is read-only`.

### Custom APIs: `/{tier}/actions/{name}[/{id}]`

A scope can publish Dataverse custom APIs — and Dataverse's own messages, such
as `CloseIncident` or `ExpandCalendar` — as routes. Each answers on the tiers
its definition lists, and **the URL picks the tier**: a caller holding
`{name}:invoke:all` who calls `/me/actions/…` is checked as `me`.

| Tier | Send | Permission | The record is checked against |
|---|---|---|---|
| `public` | nothing | none | nothing — anyone may call it |
| `me` | bearer token (+ `X-Company-Id`) | `{name}:invoke` | the caller's contact |
| `team` | bearer token (+ `X-Company-Id`) | `{name}:invoke:team` | the selected company's account |
| `all` | bearer token | `{name}:invoke:all` | the target's filters only — it must exist |

A tier the API doesn't list is a 404. The permission subject is the API's own
`requiredPermission` subject, by default its route name; grants obey the usual
implication (`invoke:all` → `invoke:team` → `invoke`) — see `permissions.md`.
`me` and `team` need a resolved contact; `all` resolves one best-effort, as
`/all` does for tables.

**`GET` invokes a function, `POST` invokes an action**, and the handler checks
this before anything else. Getting it the wrong way round is a 405 that names
the right verb:

```
Custom API "expand-calendar" is a function — use GET, not POST
```

Functions take their inputs in the query string, actions in a JSON body. The
response is always `{ "apiType": "function" | "action", "data": {…} | null }`.

**The record goes in the path, never the body.** Which record an API acts on —
and how that's checked — depends on its definition's shape:

| Shape | The id in the path | Definition carries |
|---|---|---|
| **Bound** to a record | the record Dataverse runs the API on (`incidents({id})/Microsoft.Dynamics.CRM.X`) | `target` = a route on the table Dataverse binds it to |
| **Unbound, on a record** | written into the parameter `target.recordIdPath` names | `target` + `recordIdPath` |
| **Unbound, caller-scoped** | none — a path id is a 400 | `callerParameters` (`contactId` / `accountId`) filled from the token |

A definition doesn't say whether the API is a function, or bound, or to which
table: that is read from Dataverse's `customapis` table when the definition is
saved, and a definition stating it differently is refused. Only built-in
messages (`CloseIncident`, `ExpandCalendar`) and classic actions, which aren't
in `customapis`, declare `isFunction` / `bindingType` themselves.

`target.table` names a published route, and the check then follows that route's
own contact and account paths (multi-hop and reverse joins included) plus its
filters. An inline target (`dataverseTable`, `primaryKey`, `contactColumn`,
`accountColumn`) covers a table that isn't a route.

For an unbound API the server overwrites whatever the client sent at
`recordIdPath` with the path id, in the shape the parameter needs — a raw guid,
an action's `{ "@odata.type": "Microsoft.Dynamics.CRM.incident", "incidentid": … }`,
a function's parameter alias, or `"/incidents({id})"` for an `…@odata.bind`
field. If the body named a *different* record there, the call is a 400.
`callerParameters` are overwritten the same way, silently.

**A record can be named by its reference number (API 1.29.0+).** When the
definition's target sets `recordKey` (e.g. `"ticketnumber"`, or a custom
column like `lcc_caseref`), the path segment may be that value or the GUID:
`POST /api/v2/lcc/me/actions/add-case-note/CAS-01234-X1Y2`. The server finds
the record in the same query that checks it is the caller's, so someone
else's reference number is a 404 like their GUID. It then writes what it read
from that record: the reference number into a `string` parameter, and the
GUID into a `guid` / `entityReference` parameter or as the bound record. The
column must carry an active single-column alternate key in Dataverse, or
saving the definition is refused (and a call fails closed with a 500 if the
key is later removed). In the SDK it is still `recordId`.

```http
POST /api/v2/default/me/actions/close-incident/{caseId}
{ "IncidentResolution": { "subject": "Resolved online" }, "Status": 5 }
```

The checks, in order: the API exists (404) and the verb fits (405); the tier is
listed (404); the path id is a GUID, present when the API acts on a record and
absent when it doesn't (400); auth and the tier's permission (401 / 403); the
record belongs to the caller for that tier (404 — the same answer whether it is
someone else's or doesn't exist); required parameters are present after the
server has filled its own (400). A definition the save rules should have caught
— its target table unpublished, or not the bound table — fails closed with a
500 before anything reaches Dataverse.

**Definitions published before tiers existed** (no `tiers` field) keep working.
`publicInvoke: true` means `public`. A signed-in call on
`/public/actions/{name}` still works for them, taking the tier from the caller's
*highest* grant and applying the old `ownershipCheck`, but it is deprecated:
the response carries `Deprecation: true` and a `Link` to the tiered URL. The
same API also answers on `/{tier}/actions/{name}` — `me` if its
`ownershipCheck` has a `contactColumn`, `team` if it has an `accountColumn`, and
`all`.

In the SDK, `client.me` / `client.team` / `client.all` `.invokeFunction` /
`.invokeAction` call the tier's route with the token (SDK 1.26.0 and later);
`client.public` sends none. MCP has `invoke_custom_api`. See `sdk.md`.

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

**Do not read `Access-Control-Allow-Methods` for the answer.** It is set from
the *handler's* verb list, before the tier or the table is looked at, so a list
route advertises `GET, POST, OPTIONS` even while refusing the `POST` you just
sent. It tells you what the handler implements, not what this route will accept.

Three more 405s are about the *route* rather than the verb. The first is
word-for-word the plain wrong-verb message above, so only the tier you called
tells them apart:

| `message` | Cause |
|---|---|
| `Method not allowed` | `POST` to `team` or `all` — create is `me`-only |
| `Public access is read-only` | `POST` to `public` on a table without `publicCreate` |
| `Lake-backed tables are read-only` | Any write on a route served from the data lake |

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
