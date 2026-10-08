# The TypeScript SDK

```bash
npm install @truenorth-it/dataverse-client@latest
npx dataverse-client generate --url "$API_URL" --scope "$SCOPE" --output src/dataverse.generated.ts
```

Two habits make everything below easier:

- **Stay on the latest SDK.** It tracks the API: 1.24.0 added authenticated
  custom-API calls and stopped sending the token to a crafted record id or
  paging URL, and 1.25.0 accepts the generated write types. Below 1.24.0 is a
  security finding, not just an old dependency.
  Check with `npm ls @truenorth-it/dataverse-client` and compare it with
  `npm view @truenorth-it/dataverse-client version`.
- **Generate the types, don't write them.** See *Typed clients from the live
  schema* at the end. Every example here passes a generated row type.

> **The published documentation has a bug.** Several pages tell you to install
> `@truenorth-it/dataverse-contact-api`. **That package does not exist.** If an
> install fails with a 404 from the registry, this is why — the package is
> `@truenorth-it/dataverse-client`.

## Creating a client

```ts
import { createClient } from "@truenorth-it/dataverse-client";

const client = createClient({
  baseUrl: "https://api.dataverse-contact.tnapps.co.uk",
  scope: "default",
  getToken: async () => (await msal.acquireTokenSilent(request)).accessToken,
  // apiBase: "/api/v2"   // only if the deployment is mounted elsewhere
});
```

| Option | Purpose |
|---|---|
| `baseUrl` | Deployment origin |
| `scope` | The API partition — the `{scope}` URL segment |
| `getToken` | `() => Promise<string>` called per request. Return the *access* token, not the ID token. Let MSAL handle refresh; do not cache the string yourself |
| `apiBase` | Path prefix, defaults to `/api/v2` |

## The tier accessors

The four tiers are properties on the client, and they are not interchangeable:

```ts
client.me      // rows joined to the signed-in contact
client.team    // rows joined to their account
client.all     // every row
client.public  // unauthenticated; read-only in the SDK, plus action invocation
```

### What exists where

| Method | `me` | `team` | `all` | `public` |
|---|---|---|---|---|
| `list` | yes | yes | yes | yes |
| `get` | yes | yes | yes | yes |
| `update` | yes | yes | yes | — |
| `lookup` | yes | yes | yes | — |
| `create` | **yes** | — | — | — |
| `whoami` | **yes** | — | — | — |
| `companies` | **yes** | — | — | — |
| `register` | **yes** | — | — | — |

`create`, `whoami`, `companies` and `register` exist **only** on `me`.

For `whoami`, `companies` and `register` that mirrors the HTTP surface. For
`create` it does not, quite: the API also accepts an unauthenticated
`POST /public/{table}` on a table that sets `publicCreate` (see `routes.md`),
and `client.public` has no `create` method for it. If you need a public create,
`fetch` it directly. `team` and `all` genuinely answer 405.

**Custom APIs: call an authenticated one through `client.me`** (SDK 1.24.0
and later). `client.me.invokeFunction` / `invokeAction` send the token and the
selected company; the caller needs a resolved contact and the API's invoke
permission. `client.public.invokeFunction` / `invokeAction` send no token, so
they reach only custom APIs published with `publicInvoke: true`. Both use the
same `/public/actions/{name}` path; the `public` in it decides nothing.

```ts
// A function (GET): parameters go in the query string. recordId only for an
// entity-bound API — that's where an ownershipCheck takes the record from.
const { data } = await client.me.invokeFunction<{ result: Slot[] }>("expand-calendar", {
  recordId: calendarId,
  params: { Start: start, End: end },
});

// An action (POST): parameters go in the JSON body.
await client.me.invokeAction("send-reminder", { recordId: caseId, body: { Note: "…" } });
```

A 401 from `client.public` on an action means it needs a token: use
`client.me`. It is not a reason to make the action public — `publicInvoke`
makes it callable by anyone on the internet. On an SDK older than 1.24.0, send
the token yourself with `fetch` to the same path.

**There is no `delete` method anywhere**, because there is no `DELETE` verb.
Deactivation is an update to `statecode`. For `incident`, even that will not
work as a plain update: Dataverse requires the `CloseIncident` action.

## Queries use the object dialect

The SDK does not take the raw query string. It takes structured options and
builds the URL:

```ts
const page = await client.me.list<Case>("case", {
  select: ["title", "ticketnumber", "createdon", "statuscode"],
  top: 25,
  orderBy: { field: "createdon", direction: "desc" },
  filter: [
    { field: "statecode", operator: "eq", value: 0 },
    { field: "prioritycode", operator: "eq", value: 1 },
  ],
  filterLogic: "and",
  expand: "customerid(name)",
});

page.data;        // the rows
page.page.next;   // the next-page URL, or null on the last page
```

| Option | Type |
|---|---|
| `orderBy` | `{ field: string; direction: "asc" \| "desc" }` — an object, not `"createdon:desc"` |
| `filter` | `FilterCondition \| FilterCondition[]` — a single condition need not be wrapped |
| `filterLogic` | `"and" \| "or"` |
| `expand` | `string` — the raw `lookupField(sub1,sub2)` form, **not** an object. An object serialises to `[object Object]` and 400s |

The same constraints as the HTTP layer apply: `top` maxes at 100, at most ten
filter conditions, and the operator must suit the field's type. See
`querying.md`.

### `list` returns one page — page the rest

A `list` call is **one page**: 20 rows if you leave out `top`, and never more
than 100. A `top` above 100 is cut to 100 with no error, so `top: 500` looks
like it worked and drops the rest. Any list that can grow past one page has to
follow `page.next`:

```ts
// Next page, e.g. behind a "Load more" button. Pass page.next exactly as the
// API returned it: it carries the cursor and your query options.
const first = await client.me.list<Case>("case", { top: 50 });
const second = first.page.next ? await client.me.fetchPage<Case>(first.page.next) : null;

// Every page, for a bounded set (an export, a dropdown's options):
for await (const page of client.me.eachPage<Case>("case", { top: 100 })) {
  rows.push(...page.data);
}
```

In React, `useInfiniteQuery` fits it directly. The first page comes from
`list`, later ones from `fetchPage(pageParam)`, and
`getNextPageParam: (last) => last.page.next ?? null`. Don't drain every page
into a screen with `eachPage`: the list grows with the data, and so does the
wait.

There is no offset paging. Don't count rows with `skip`; see `querying.md`.

### Paging and your query options

`fetchPage(page.page.next)` and `eachPage(...)` follow the server's `next` URL
exactly as given. From API 1.24.0 that URL carries your `select`, `filter`,
`filterLogic` and `expand`, so paging just works.

**Pass `page.next` to `fetchPage()` untouched — don't append your query to
it.** It already carries your query, so appending sends every parameter twice.
Up to API 1.25.0 the API echoed both copies into the next link, so the URL grew
each page until a `414 URI Too Long`, and a lookup's doubled `search` was
dropped. `eachPage()` never appends, which is why it never hit this.

Only on a deployment older than 1.24.0 does `next` drop your query: an
`eachPage()` loop then yields a correctly filtered first page and
**unfiltered** ones after it, with nothing to signal the change. There, take
the cursor from `next` and rebuild the URL from your page-1 query each time —
see `querying.md`. Upgrading the API is the better fix.

## Errors

Every non-2xx throws an `ApiError`:

```ts
import { ApiError } from "@truenorth-it/dataverse-client";

try {
  await client.team.update("case", id, { title: "…" });
} catch (e) {
  if (e instanceof ApiError) {
    e.status;      // 403
    e.statusText;  // "Forbidden"
    e.body;        // { error, message, statusCode } — the parsed API envelope
  }
}
```

Show `e.body.message` to a developer; do not show it to a citizen. A 403 body
naming `case:write:team` is precise and also meaningless to the end user, and
other messages echo request input back. (From API 1.24.0, Dataverse's raw error
text is replaced by a generic message and a correlation id; older deployments
pass it on.)
`e.message` is the same text. Map on `e.status` for the screen, log the rest.

## Context helpers

```ts
client.withContact(contactId);   // act in the context of a specific contact
client.withCompany(companyId);   // pick the active company for team scoping
```

Both return a derived client and leave the original alone. `withCompany` is what
you wire to a company switcher when `whoami` reports
`hasMultipleCompanies: true` — it changes what `team` resolves to.

Neither is impersonation. The API checks the id against the contacts and
companies the caller's own email resolves to, and refuses anything else — a 403
on `me`, `team` and writes. They choose between identities the caller already
has.

When the selection changes, so does what every query returns. Put the selected
company id in every TanStack Query key (or clear the cache on switch), or the
UI shows one company's rows under another's name until the refetch lands.

## Realtime

```ts
await client.negotiate();   // SignalR negotiate for live updates
```

There is also a `useRealtime` helper that subscribes and automatically
invalidates the matching TanStack Query caches when a row changes, so a list
re-fetches itself without you wiring an event handler per query key. Prefer it
over hand-rolled invalidation — the key-matching is the fiddly part.

An event says *that* a row changed — a table, an action and a `recordId` — not
that this caller may see it. Let the scoped refetch decide; never render from an
event, and never treat its `recordId` as one of the caller's own rows.

## What the SDK takes on trust

Two inputs go out exactly as given, with the caller's token attached:

- **Record ids.** `get(table, id)` and `update(table, id, …)` put `id` into the
  request path unencoded. An id taken from a route param (`/case/:id`) is
  whatever the address bar said — check it is a GUID before passing it on.
- **Next-page URLs.** `fetchPage(url)` sends the bearer token to any absolute URL
  it is handed. Give it the `page.next` the API returned, as returned, never a
  URL from anywhere else.

## Typed clients from the live schema

```bash
npx dataverse-client generate --url "$API_URL" --scope "$SCOPE" --output src/dataverse.generated.ts
```

It reads the scope's public `/schema` and `/choices` (no token) and writes one
file. Add it as a `generate:types` script, commit the output so a schema change
shows up in the diff, and never edit it by hand. `--output` must point into a
directory that exists. The command doesn't create one.

For each table it emits:

| Export | What it's for |
|---|---|
| `Case` | The row: `list<Case>`, `get<Case>`. Choice columns come with their `_label` |
| `CaseField` | Column-name union. `QueryOptionsFor<CaseField>` checks `select`, `filter.field` and `orderBy.field` at compile time, so a typo can't become a runtime 400 |
| `CaseCreateInput` / `CaseUpdateInput` | Writable columns only. Read-only ones and the lookups `createDefaults` binds are left out |
| `CaseStatuscode`, … | A const object per choice column (`CaseStatuscode.InProgress`), so filters don't use magic numbers |

Names come from the route, not the entity: route `incident` gives `Incident`,
`IncidentField` and so on, and `casenotes` gives `Casenotes`. On a Service
Builder scope it also types each service's submitted form.

```ts
import type { QueryOptionsFor } from "@truenorth-it/dataverse-client";
import {
  CaseStatecode,
  type Case,
  type CaseField,
  type CaseCreateInput,
} from "./dataverse.generated";

const open: QueryOptionsFor<CaseField> = {
  select: ["incidentid", "ticketnumber", "title", "statuscode"],
  filter: { field: "statecode", operator: "eq", value: CaseStatecode.Active },
  orderBy: { field: "modifiedon", direction: "desc" },
};
const page = await client.me.list<Case>("case", open);

const input: CaseCreateInput = { title: "VPN down", description: "Site B offline" };
await client.me.create<Case>("case", input);
```

That last line needs SDK 1.25.0. Older versions type `create` / `update`'s
payload as `Record<string, unknown>`, which a generated interface doesn't
satisfy under `strict` (TS2345, "Index signature … is missing"). Upgrade
rather than casting; `{ ...input }` works if you can't.

An expand adds a nested object the row type doesn't describe. Extend the row
type for that one call (`Case & { customerid_contact?: { fullname?: string } }`)
rather than hand-writing a parallel interface. For a narrower view, use
`Pick<Case, …>`.

Regenerate whenever the scope's tables change. Stale types still run; you only
lose the new columns' names.
