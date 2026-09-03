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
| `/changes/{table}?deltaToken=` | `GET` | Delta query. Pass back the token from the previous response |

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

## Scope-level routes

| Route | Auth | Returns |
|---|---|---|
| `/{scope}/me/whoami` | valid token | identity, contact, companies — see below |
| `/{scope}/schema` | **none** | every published table in the scope |
| `/{scope}/schema?table={table}` | none | one table's fields and types |
| `/{scope}/openapi.json` | none | OpenAPI document for the scope |
| `/{scope}/choices/{table}` | any permission on the subject | all option sets on the table |
| `/{scope}/choices/{table}/{field}` | any permission on the subject | one option set |

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
  "dataverseContact": { … } ,
  "companies": [ … ],
  "hasMultipleCompanies": false
}
```

`dataverseContact` is `null` when no contact matched the email claim — the call
still returns 200. This is intentional: `whoami` is a diagnostic and answers
wherever it can. See `troubleshooting.md`.

## Admin routes

Note the segment order — `_admin` comes **before** the scope, unlike everything
else:

| Route | Auth |
|---|---|
| `/api/v2/_admin/scopes` | **none** — public. Lists the deployment's scopes |
| `/api/v2/_admin/{scope}/table-manager/defaults` | `admin:{scope}` |
| other `/api/v2/_admin/{scope}/…` | `admin:{scope}` |

`table-manager/defaults` returns `{ "defaults": …, "effective": … }` —
`defaults` is what is published, `effective` is what the API will actually apply
after resolution. When they disagree, `effective` is the truth.

Admin credentials are covered in `admin.md`.

## Response envelopes

| Response | Body | Status |
|---|---|---|
| List | `{ "data": [ … ], "page": { "top": n, "next": … } }` | 200 |
| Single | `{ "data": { … } }` | 200 |
| Create | `{ "data": { … } }` | **201** |
| Update | `{ "data": { … } }` | 200 |
| Error | `{ "error": …, "message": …, "statusCode": n }` | 4xx / 5xx |

Rows are always under `data`. Choice fields arrive with a `_label` companion —
`statuscode` and `statuscode_label`. Use the label for display.

## Response headers

| Header | Meaning |
|---|---|
| `X-Cache: HIT` / `MISS` | Whether the response came from cache. A `HIT` explains a stale read |
| `X-Data-Source: lake` | The read was served from the data lake rather than live Dataverse |
| `X-Deprecated-Field` | The request referenced a field scheduled for removal. Not an error today; fix it before it becomes one |

Log these when a response looks wrong. `X-Cache: HIT` on a row you just updated
is the answer, not a mystery.

## Operational endpoints

`/health` and `/cache-stats` exist **only on the container deployment**. The
Vercel serverless deployment does not serve them, so a monitor pointed at
`/health` will report the API down when it is fine.

Use `GET /api/v2/{scope}/schema` as the universal readiness probe: it needs no
credentials, exists on every deployment, and a 200 proves the scope's config
actually loaded — which `/health` would not tell you anyway.
