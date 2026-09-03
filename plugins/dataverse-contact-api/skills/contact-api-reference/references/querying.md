# The query dialect

**This is not OData.** It resembles it enough to mislead, and the differences
are exactly where clients break. There is no `$` prefix on anything, `filter`
uses spaces rather than OData's operator syntax, and paging is cursor-based.

Writing `$select=name&$filter=statecode eq 0` gets you an unrecognised-parameter
error or, worse, silently ignored parameters.

## Parameters

| Parameter | Form | Notes |
|---|---|---|
| `select` | `select=title,createdon,statuscode` | Comma-separated. Omit for the route's default select. |
| `top` | `top=50` | **Default 20, maximum 100.** Above 100 it is **silently clamped**, not rejected — so a request for 500 returns 100 and looks like a truncated dataset. Zero or negative is a 400: `'top' must be a positive integer` |
| `orderBy` | `orderBy=createdon:desc` | `field:asc` or `field:desc`, split on the colon. Direction defaults to `asc`. Not `field desc` |
| `filter` | `filter=statuscode eq 1` | Space-separated `field operator value`. **Repeatable**, max 10 conditions |
| `filterLogic` | `filterLogic=or` | `and` (default) or `or`. Combines *all* the `filter` conditions; there is no per-condition grouping |
| `expand` | `expand=customerid(name,emailaddress1)` | `lookupField(sub1,sub2)`. A bare `name` with no parentheses expands every configured field |
| `created` | `created=7d` | Quick date filter on `createdon` |
| `modified` | `modified=today` | Quick date filter on `modifiedon` |
| `cursor` | `cursor=…` | Paging. You never build this — take it from `page.next` |
| `search` | `search=smith` | **Lookup routes only** — `/{tier}/lookup/{table}` |

Aggregate routes add `aggregate` (required) and `groupBy`, each capped at 10
entries. `sum` and `average` work only on `number` and `choice` fields; asking
for either on a string or datetime is a 400.

### Repeating `filter`

Each condition is its own `filter` parameter:

```
?filter=statuscode eq 1&filter=prioritycode eq 2&filterLogic=and
```

URL-encoded in practice, so the spaces become `%20` or `+`. Ten conditions is
the ceiling; an eleventh is `Too many filters (max 10)`.

The value is everything after the *second* space, taken verbatim — so spaces in
the value are fine and need no quoting: `filter=title contains annual review`.

### Filtering on a parent row

Where a route declares a parent table, a `parent.` prefix filters across the
relationship:

```
?filter=parent.ticketnumber eq CAS-001234
```

The parent's fields are a different set from the route's own — discover them
with `schema?table={parentTable}`.

### Date quick filters

`created` and `modified` accept:

| Form | Values |
|---|---|
| Named period | `today`, `yesterday`, `thisweek`, `lastweek`, `thismonth`, `lastmonth`, `thisyear` |
| Relative | `<n>h` or `<n>d` — `1h`, `24h`, `7d`, `30d`, `90d` |
| Explicit range | `2026-01-01..2026-02-01`; either end may be omitted (`..2026-02-01`) |

Use these rather than hand-building datetime comparisons — they are less
error-prone than getting Dataverse's UTC handling right yourself. Anything else
is a 400 listing the valid formats.

## Operators, by field type

The API rejects an operator the field's type does not support. This is a
deliberate 400, not a silent no-op.

The full operator vocabulary is `eq, ne, gt, ge, lt, le, contains, startswith,
endswith`. Which of them a given field accepts depends on its type:

| Field type | Operators |
|---|---|
| string | `eq`, `ne`, `contains`, `startswith`, `endswith` |
| number, choice, datetime | `eq`, `ne`, `gt`, `ge`, `lt`, `le` |
| boolean, lookup | `eq`, `ne` |

Note there is no `contains` on a choice field — filter on the numeric value.
Getting it wrong is a 400 that names the allowed set:

```
Operator 'contains' is not valid for choice field 'statuscode'. Allowed: eq, ne, gt, ge, lt, le
```

## Unknown fields are a hard 400

Misspell a field in `select`, `filter`, `orderBy`, `groupBy` or `expand` and the
request fails. It does not quietly drop the parameter:

```
Cannot filter by unknown field 'titel' for case. Did you mean 'title'?
Use GET /api/v2/default/schema?table=case to see available fields.
```

The `Did you mean` fragment only appears for a near miss — a case-only
difference, or a raw `_x_value` name that maps to a configured lookup. For
anything further off you get the message and the schema pointer without a
suggestion, which is still enough to fix it.

Treat this as a feature: a green response is evidence the field names are right.
When you do not know them, read `GET /api/v2/{scope}/schema?table={table}`
rather than guessing at Dataverse logical names — the published route often
exposes a renamed subset.

## Paging is cursor-based

A list response carries the next page ready-made:

```json
{
  "data": [ … ],
  "page": { "top": 20, "next": "/api/v2/default/me/case?top=20&cursor=<opaque>" }
}
```

**`page.next` carries only `top`, `cursor` and `orderBy`.** That is the whole
URL the server builds. Every other parameter you sent on page 1 is dropped:

| In `page.next` | Dropped — you must re-append it |
|---|---|
| `top`, `cursor`, `orderBy` | `select`, `filter`, `filterLogic`, `expand`, `created`, `modified` |

So a client that follows `page.next` verbatim gets page 2 of the route's
**default select, unfiltered** — wider than page 1, differently shaped, and with
no error to say so. The tier join still applies, so nobody else's rows appear;
what you get is your own rows that page 1's filter excluded, carrying whatever
fields the route defaults to. Closed cases reappearing halfway down an "open
cases" list is the classic sighting.

Take `cursor` and `top` from `next`, keep the `orderBy` it hands back, and
re-send everything else exactly as you sent it on page 1:

```
# page 1
GET /api/v2/default/me/case?select=title,statuscode&filter=statecode%20eq%200
    &orderBy=createdon:desc&top=20

# page.next says:
/api/v2/default/me/case?top=20&cursor=<opaque>&orderBy=createdon:desc

# what you must actually request
GET /api/v2/default/me/case?top=20&cursor=<opaque>&orderBy=createdon:desc
    &select=title,statuscode
    &filter=statecode%20eq%200
```

Never build the `cursor` yourself — it is opaque and wraps the data layer's own
paging token. When `page.next` is `null`, you are on the last page.

This bites the SDK too: `fetchPage()` and `eachPage()` both follow `page.next`
as given, so an `eachPage()` loop started with a filter returns a filtered first
page and unfiltered ones after it. See `sdk.md`.

There is no offset paging. `skip` is accepted as a parameter but a positive
`skip` without a cursor is a 400:

```
Invalid pagination state. Use the cursor from 'page.next' to page through results.
```

So a numbered page picker that jumps straight to page 7 is not something this
API can serve. Build "load more", or a next/previous stack of cursors.

## Choice fields come with labels

Any choice (option set) field is returned alongside an automatic `_label`
companion:

```json
{
  "statuscode": 1,
  "statuscode_label": "In Progress"
}
```

**Use the `_label` for display and the raw value for filtering.** Hard-coding a
mapping from `1` to `"In Progress"` in the client duplicates configuration that
already ships with every response, and drifts the moment someone renames an
option in Dataverse.

Lookup fields get the same treatment plus a `_logicalname` companion, and a
polymorphic lookup's expanded row arrives as `_record`. **Lake-backed tables
(`X-Data-Source: lake`) get no label enrichment at all** — if `_label` fields
vanish when you switch a route to the lake, that is why.

`GET /api/v2/{scope}/choices/{table}[/{field}]` gives the full option set when
you need to render a dropdown of values the current rows do not happen to
contain.

## Response envelopes

| Response | Shape | Status |
|---|---|---|
| List / lookup | `{ "data": [ … ], "page": { "top": n, "next": … } }` | 200 |
| Single record | `{ "data": { … } }` | 200 |
| Create | `{ "data": { … } }` | **201** |
| Update | `{ "data": { … } }` | 200 |
| Aggregate | `{ "data": [ … ] }` — no `page` | 200 |
| Changes | `{ "changed": [ … ], "removed": [ … ], "deltaToken": …, "hasMore": … }` | 200 |
| Error | `{ "error": …, "message": …, "statusCode": n }` | 4xx / 5xx |

Rows are always under `data`. A client that reads the array off the root of a
list response will get `undefined` and, typically, blame auth. The `changes`
route is the one exception to the envelope — it has its own shape.

In an error body, `error` is the status label (`"Bad Request"`, `"Forbidden"`,
`"Not Found"`, `"Method Not Allowed"`) and `message` is the specific,
human-readable cause. Log `message`; it is the field that identifies the
problem.

## Worked queries

```bash
# My open cases, newest first, ten at a time
GET /api/v2/default/me/case
    ?select=title,ticketnumber,createdon,statuscode
    &filter=statecode%20eq%200
    &orderBy=createdon:desc
    &top=10

# My team's cases raised this week, with the customer's name pulled in
GET /api/v2/default/team/case
    ?expand=customerid(name)
    &created=thisweek
    &orderBy=createdon:desc

# Two conditions, OR'd
GET /api/v2/default/me/case
    ?filter=prioritycode%20eq%201
    &filter=prioritycode%20eq%202
    &filterLogic=or

# Type-ahead against a lookup
GET /api/v2/default/me/lookup/account?search=north&top=10

# How many cases per status
GET /api/v2/default/team/aggregate/case?aggregate=count&groupBy=statuscode
```
