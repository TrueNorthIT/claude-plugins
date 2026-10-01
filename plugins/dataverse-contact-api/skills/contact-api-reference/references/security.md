# Security — what the API enforces, and what it takes on trust

The Contact API is the only thing between a browser and Dataverse. It enforces
a great deal on every request — but only what the scope declares, and nothing
about what happens in the browser. This file separates the three:

- what the server guarantees whatever the client does;
- what it applies exactly as configured, so that a scope can be published that
  works perfectly and leaks;
- what is the client's job alone.

Two roles get this wrong in different ways. A **scope designer** publishes
routes, fields, joins and baseline permissions — through Terraform, the Table
Manager or the `contact-admin` CLI. A **client developer** writes the portal.
Most of what follows is for the first, because most of the boundary is theirs.

## What the server enforces

| Decision | Made by | Notes |
|---|---|---|
| Is the token genuine? | signature, issuer, audience, expiry | Nothing else in the token is verified — see *The email claim is the identity* |
| Who is the caller? | the email claim, matched to `contact.emailaddress1` | `auth.md` |
| Which rows? | the route's join path for the tier | The client sends no ownership filter, so it has none to widen |
| May they do this? | permission strings: the scope's defaults ∪ that contact's `cpa_apipermission` rows | `permissions.md` |
| Which columns exist? | the route's `fields` | An undeclared column in a write body is a 400 |
| Which columns may be written? | `fields` not marked `readOnly` | A read-only column is **dropped silently** — on create as well as PATCH |
| May a write point at that row? | the lookup-ownership check, on `/me` and `/team` writes | Only for lookups whose `lookupTable` resolves — see below |
| Which company? | `X-Company-Id` / `X-Contact-Id`, compared with the caller's own contacts and companies | A value that isn't theirs is refused — a 403 on `me`, `team` and writes — never an impersonation |

So everything a scope publishes is reachable by anyone with a valid token and
`curl`. The portal's UI is not part of the boundary in either direction. Hiding
a button protects nothing, and a client cannot make the API return more than
the scope allows.

## What a scope designer is trusted to get right

The server applies each of these exactly as written.

### The baseline reaches every token, not every portal user

`defaults.json` is "what every signed-in caller gets". Take that literally: it
is every token the scope accepts, which is wider than this portal's users.

- **Callers with no Dataverse contact.** `me` and `team` need one; `all` does
  not, and the defaults apply either way. `case: ["all"]` in defaults lets
  anyone who can sign in read every case — no contact, no registration, no
  grant.
- **Users of every other portal on the deployment.** A scope that does not set
  its own `{SCOPE}__OIDC_AUDIENCE` accepts the same tokens as every other scope
  without one. Someone signed in to portal A can call scope B, and gets B's
  defaults.
- **Anyone on the internet**, where the identity provider allows self-service
  sign-up — which an Entra External ID tenant usually does.

So **no `all`, and no action ending in `:all`, in defaults** — `write:all`,
`lookup:all` and `invoke:all` included (an `:all` invoke tier reduces an
`ownershipCheck` to "the record exists"). Unscoped access belongs to named
people, as per-person grants. To keep one portal's users out of another scope
entirely, give that scope its own audience.

Defaults are keyed by route name, so publishing a route into a scope whose
defaults already name it grants that baseline the moment it publishes. (A key
that names a `permissionGroup` but no route grants nothing.)

### `team` is only as narrow as the account model

`team` means rows reachable from the caller's account. In a business portal
that is their colleagues. In a citizen portal where contacts were bulk-loaded
under one catch-all account, it is every citizen. Look at how contacts are
actually parented before granting any `team` permission.

### Writes: what the caller controls

- **A field is writable unless it says `readOnly`.** Mark everything the caller
  must not set: identifiers, status and priority, owner, dates, and the identity
  columns below.
- **`readOnly` can't express "settable on create, fixed afterwards"** — it drops
  the value on both. For anything that decides ownership or status, choose
  read-only.
- **Every field a `createDefaults` entry binds should be `readOnly`.** On an
  authenticated create the default overwrites whatever the caller sent. It does
  nothing to stop a later PATCH, and it applies to nothing on an anonymous
  `publicCreate`, where there is no caller to bind.
- **Make a lookup `readOnly` unless the caller has to choose it.** That is the
  control that holds everywhere. When they do have to choose it, its
  `lookupTable` matters: a writable lookup is checked only if `lookupTable`
  resolves to a route published in the same scope, with a join path for the
  tier being written. A lookup with no `lookupTable`, or naming a route the
  scope doesn't publish, is written with no check that the caller owns the
  target.
- **`write:all` is unscoped, lookups included.** Whoever holds it can point any
  writable lookup at any row.

### Identity columns are never writable

| Column | What a writable one allows |
|---|---|
| `contact.emailaddress1` | It is the sign-in key. The caller can detach their contact from their own login — and, with any write tier above `me` on contacts, set someone else's address to their own and then sign in *as* that contact |
| the company link (`parentcustomerid`) | It decides `team`. The caller can move themselves into another company |
| any column a join path follows | It decides whose a row is |
| the account column a `join` reads (`domain_field`) | It decides who may self-register into that company |

Keep `contact:write:team` and `contact:write:all` out of defaults altogether.

### Reads: what the caller can see

- **`fields` is the exposure, not `defaultSelect`.** A caller can `select` and
  `filter` on any column in `fields`, on every tier including `public`, and even
  a lookup-only grant can filter on all of them to infer what it can't select.
  Leave out what no portal needs: internal notes, risk or safeguarding flags,
  staff-only comments.
- **Never leave `defaultSelect` empty, and give every expand an explicit field
  list.** An empty list means "no projection", not "nothing".
- **An expand is as exposed as the parent row.** It returns its configured
  fields from whatever row the lookup points at — no join, no filters on the
  related row, on every tier including `public`. An `ownerid` expand that
  includes a staff member's email address publishes it to everyone who can read
  the parent.
- **`fetchXml` replaces the join path and the route's `filters`** for list
  queries. Rows are scoped only by `{{contactid}}` / `{{accountid}}`
  placeholders in the template. A template without them returns the same rows
  on every tier the route serves (`public` too, if it is `publicRead`), and
  ignores the caller's `select` / `filter`. Prefer join paths, and review any
  FetchXML route as a security change.
- **A child route sees everything its join reaches.** Notes or activities joined
  through the case return every note on the case, including the ones staff
  wrote for each other. Filter to what is meant for the customer, or don't
  publish the route.
- **`permissionGroup` widens a child to its parent's grants** — all of them,
  including any per-person `:all` grant on the parent's subject.

### The public tier

- **`publicRead`** exposes every column in `fields` (not just `defaultSelect`),
  every configured expand, and — by paging — every row the route's `filters`
  allow, to anyone.
- **`publicCreate`** accepts anonymous inserts. With no caller, `createDefaults`
  bind nothing and lookups are not ownership-checked, and the 201 echoes the
  new row using `defaultSelect`. Give a `publicCreate` route no writable
  lookups, no writable join-path columns and a short `defaultSelect`. It does
  not require `publicRead`.
- **The API does no rate limiting.** Anything public needs it at the edge — a
  WAF, Front Door, a gateway. A CAPTCHA in the portal protects nothing, because
  the endpoint can be called without the portal.
- **Metadata is public regardless.** `/{scope}/schema`, `/{scope}/openapi.json`
  and (unless `publicChoices: false`) `/{scope}/choices` need no token and cover
  every published route. Field names, descriptions and option labels are public;
  write them that way.

### Custom APIs

- **`publicInvoke: true` means anonymous.** Without it, `/public/actions/{name}`
  needs a token, a resolved contact and the invoke permission — the `public` in
  the path changes nothing. Make an action public only when anonymous use is the
  point.
- **Custom APIs are not row-scoped.** An action that acts on a record needs an
  `ownershipCheck`, or the caller can name any record id the action accepts. The
  check runs only on authenticated calls, so alongside `publicInvoke` it does
  nothing.
- **A function (`isFunction: true`, called with `GET`) must have no side
  effects**, above all when it is `publicInvoke`: anyone's web page can trigger
  an anonymous `GET` with an image tag.
- The SDK's `invokeFunction` / `invokeAction` send no token, so a portal using
  them can reach only `publicInvoke` APIs. That is a reason to send the token
  directly (`sdk.md`), never to make an action public.

### Self-registration

- **`allowSelfRegister`** lets anyone who can sign in create a contact, with the
  email from their token, and receive the defaults immediately.
- **With a `domain-list` join, the account's domain column decides who joins
  which company.** Only staff should be able to edit it, and it must never list
  a shared or consumer domain. The API refuses a short built-in list (gmail.com,
  outlook.com, icloud.com and similar) but treats any other domain — an ISP's, a
  regional mail provider's — as belonging to a company.
- **`requireMatch: false`** gives an unmatched stranger an unlinked contact.
  That is safe only if an unlinked contact, holding just the defaults, can't
  reach anything it shouldn't.

## The email claim is the identity

- The API matches the token's email, lowercased, against
  `contact.emailaddress1`. Whoever the identity provider issues a token for that
  address **is** that contact, as far as the API is concerned.
- The API verifies the token's signature, issuer, audience and expiry, and takes
  the claim's value on trust. So the identity provider must only ever put a
  **verified** address in it. Entra External ID's email sign-up verifies it; a
  federated or custom provider may not. The claim is read from
  `{SCOPE}__OIDC_EMAIL_CLAIM` if set, falling back to `email`, then
  `preferred_username` (when it contains `@`), then `emails[]` — every claim on
  that chain must be one the provider has verified and the user cannot edit.
- Every contact with a matching address resolves, active or inactive. In the
  parent-account model several matches become a choice of company; in the
  associated-accounts model the oldest wins (`auth.md`). **Deactivating a
  contact does not revoke portal access.** To cut someone off, block their
  sign-in at the identity provider *and* change or clear the contact's
  `emailaddress1` — otherwise a new account with the same address matches it
  again.
- Neither is instant. A token already issued keeps working until it expires
  (about an hour), because the API checks only its signature, issuer, audience
  and expiry; contact matches and permissions are also cached for five minutes.
- To withdraw one per-person grant, delete or deactivate its
  `cpa_apipermission` row.

## What the client can't protect, and must not break

The server's guarantees end at the response.

- **Injected script is the user.** It can call the API with their token and
  every permission they hold, and token storage doesn't change that — it can ask
  MSAL for a fresh token. Render API text as text, sanitise any HTML with an
  allow-list sanitiser such as DOMPurify, and send a Content-Security-Policy.
- **Public build-time variables are published.** Vite's `VITE_*` and every other
  bundler's equivalent end up in the bundle. Admin connection keys, MCP keys,
  service-principal secrets and Web PubSub or SignalR access keys never go in a
  browser app.
- **The tier is a design decision, not a fix.** An empty `/me` list or a 404 is a
  join or contact problem (`troubleshooting.md`). Switching the client to `/all`,
  or asking for an `:all` grant, either fails with 403 or shows the citizen
  everyone's rows.
- **Error messages aren't for citizens.** A `message` can carry Dataverse's raw
  error text and echo request input. Show a fixed message; log the real one.
- **Realtime events are a prompt to refetch, not data.** An event's `recordId`
  says something changed; the scoped route decides whether this caller may see
  it.
- **Ids from the address bar are untrusted.** The SDK puts an id into the request
  path as given and `fetchPage` sends the token to any URL it is handed —
  `sdk.md`.

The `dataverse-portal` plugin turns these into rules for the code it generates,
plus response headers and a go-live checklist.

## Defence in depth

Each scope's API traffic runs as one Dataverse application user. Give it a
security role covering what the scope's routes actually need, not System
Administrator: then a route published by mistake can reach only what that role
allows. In front of the API, edge rate limiting and a WAF; behind sign-in, an
identity provider that verifies email addresses.

## Abuse tests before go-live

With two real test contacts, A and B, for each route:

| Test | Expect |
|---|---|
| `contact-admin tables test-query <route> --tier me --contact-id <a GUID matching no contact>` — and, on a route that serves `team`, `--tier team --account-id <a GUID matching no account>` | **0 rows.** Any rows mean the route is not filtering by caller — usually a `fetchXml` template without its placeholder |
| B requests A's record by id at `me` | 404 |
| A PATCHes a column that should be read-only, alongside a writable one | 200, and the read-only value unchanged (a body of only read-only columns is a 400 `nothing to update`) |
| A creates or PATCHes with a **writable** lookup (one with a `lookupTable`) pointing at B's row | 403 `… does not belong to you`. A read-only lookup is simply dropped, so it can't fail this way |
| A citizen's token at `/all/<route>` | 403 |
| No token at `/me/<route>`; at `/public/<route>` | 401; 404 unless the route is deliberately public |
| A token from another portal on the same deployment, against this scope | 401 if the scope has its own audience; otherwise only what this scope's defaults are meant to give |

The first needs only an admin credential (`admin.md`); the rest need a token
for each test contact. Run them again after any change to a join, a permission
or a `readOnly` flag.
