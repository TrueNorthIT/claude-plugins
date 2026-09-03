# The TypeScript SDK

```bash
npm install @truenorth-it/dataverse-client
```

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

**There is no `delete` method anywhere**, because there is no `DELETE` verb.
Deactivation is an update to `statecode`. For `incident`, even that will not
work as a plain update: Dataverse requires the `CloseIncident` action.

## Queries use the object dialect

The SDK does not take the raw query string. It takes structured options and
builds the URL:

```ts
const page = await client.me.list("case", {
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

### Paging drops your query options

`fetchPage(page.page.next)` and `eachPage(...)` follow the server's `next` URL
exactly as given, and that URL carries only `top`, `cursor` and `orderBy` — not
`select`, `filter`, `filterLogic` or `expand`. An `eachPage()` loop therefore
yields a correctly filtered first page and **unfiltered** ones after it, with
nothing to signal the change.

`list()` takes no `cursor` option, so you cannot re-issue the query with one.
The way round it is to append your own parameters to the `next` URL and hand
that to `fetchPage()`, which sends whatever string you give it:

```ts
const qs = "&select=title,statuscode&filter=statecode%20eq%200";
let page = await client.me.list<Case>("case", opts);
while (page.page.next) {
  page = await client.me.fetchPage<Case>(page.page.next + qs);
}
```

See `querying.md` for the full list of what `page.next` drops.

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
naming `case:write:team` is precise and also meaningless to the end user.

## Context helpers

```ts
client.withContact(contactId);   // act in the context of a specific contact
client.withCompany(companyId);   // pick the active company for team scoping
```

Both return a derived client and leave the original alone. `withCompany` is what
you wire to a company switcher when `whoami` reports
`hasMultipleCompanies: true` — it changes what `team` resolves to.

## Realtime

```ts
await client.negotiate();   // SignalR negotiate for live updates
```

There is also a `useRealtime` helper that subscribes and automatically
invalidates the matching TanStack Query caches when a row changes, so a list
re-fetches itself without you wiring an event handler per query key. Prefer it
over hand-rolled invalidation — the key-matching is the fiddly part.

## Typed clients from the live schema

```bash
npx dataverse-client generate --url "$API_URL" --scope "$SCOPE"
```

Reads the scope's published schema and emits TypeScript types for its tables and
fields. Worth doing early: it turns a misspelled field — which would otherwise be
a runtime 400 with a "did you mean" hint — into a compile error.

Regenerate whenever the scope's tables change, and commit the output so a
reviewer can see a schema change arrive in the diff.
