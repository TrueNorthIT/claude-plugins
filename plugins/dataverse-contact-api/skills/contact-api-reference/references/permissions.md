# Permissions

Every authorisation decision in the Contact API is a string comparison against a
resolved permission list. There are no app roles, no OAuth scopes per operation
and no group claims — the token proves *who you are*, and nothing about what you
may do. All of that lives inside the API.

## The grammar

```
<subject>[:<operation>][:<tier>]
```

| Part | Values | Default if omitted |
|---|---|---|
| `subject` | the route name — `case`, `contact`, `casenotes`, … | required |
| `operation` | `write`, `create`, `lookup`, `invoke` — omitted means *read* | read |
| `tier` | `me`, `team`, `all` | `me` |

So:

| String | Means |
|---|---|
| `case` | read your own cases |
| `case:team` | read your team's cases |
| `case:all` | read every case |
| `case:write` | edit your own cases (tier `me`, operation `write`) |
| `case:write:team` | edit your team's cases |
| `case:create` | create a case (create only ever exists at `me`) |
| `case:lookup` | use the lookup route on cases |

A bare `case:write` is **tier `me`**, not "write anywhere". This trips people up
because the tier is the *last* segment, so the two-segment form looks like it
might be `subject:tier`. It is not — a two-segment string is always
`subject:operation`.

## What implies what — `permImplies`

A held permission satisfies a required one when:

| Rule | Example |
|---|---|
| The **subject must match exactly**. Never inferred across routes. | `case:all` does nothing for `casenotes` |
| A **higher tier implies a lower one, for the same operation**. `all` > `team` > `me`. | `case:write:all` satisfies `case:write:team` and `case:write` |
| **Read implies lookup.** | `case:team` satisfies `case:lookup:team` |
| **Write, create and lookup never imply read.** | `case:write` alone does not let you `GET /me/case` |
| A **lower tier is never promoted.** | `case:write` can never satisfy `case:write:team` |

The last two are the ones that matter in practice. They are also what makes the
model useful, because they let you grant edit and read at *different* widths.

### The worked example

Granting the `case` subject:

```json
{ "case": ["me", "team", "write", "create"] }
```

resolves to `case`, `case:team`, `case:write`, `case:create`, which gives:

| Request | Result |
|---|---|
| `GET /me/case` | 200 — your own cases |
| `GET /team/case` | 200 — your colleagues' cases |
| `POST /me/case` | 201 — create your own |
| `PATCH /me/case/{id}` | 200 — edit your own |
| `PATCH /team/case/{id}` | **403** — `case:write` does not imply `case:write:team` |

That is "read my colleagues' cases, but only edit my own", and it is enforced by
the server on every request. It is not a UI decision, and hiding the edit button
is not what makes it true. If you want team edit, you must grant
`case:write:team` explicitly.

## Where permissions come from

Two **additive** layers, resolved per request and unioned:

| Layer | Source | Applies to |
|---|---|---|
| 1 | the scope's published `defaults.json` | every authenticated caller in the scope |
| 2 | `cr_apipermission` rows in Dataverse, keyed to the caller's contact | that one person |

Layer 2 is optional and **fails open to layer 1** — if the per-user lookup
errors, the caller keeps their defaults rather than losing everything. There is
no subtraction: a `cr_apipermission` row can only widen, never revoke. To take
something away you must change the defaults.

### The 5-minute cache

The resolved permission set is cached for **5 minutes**. A grant or revoke is
therefore not instant, and neither is a change to `defaults.json` for callers
already in flight. When testing a permission change, wait it out — do not chase
a 403 that is simply stale.

### The empty-defaults trap

A scope managed via blob storage that has **never published a `defaults.json`
grants nothing at all**. Not "read-only" — nothing. Every route, including plain
reads, answers:

```
403 Missing required permission: <route>
```

This is by far the most common reason a newly created scope appears dead on
arrival, and it looks nothing like a configuration problem: the token is valid,
the tables are published, `schema` returns them, and every call still 403s.
Check the published defaults first.

In Terraform terms this is the `dataversecontact_permissions_sync` resource
never having been applied — see the `dataverse-terraform` plugin.

## Reading a 403

| Body | Means |
|---|---|
| `Missing required permission: case` | You have no read on `case` at any tier — or the scope has no published defaults at all |
| `Missing required permission: case:write:team` | You hold `case:write` but asked at the `team` tier |
| `Missing required permission: admin:{scope}` | An `_admin` route with a non-admin credential |

A 403 is always about the *permission list*. A 404 is about the *join* — the row
exists but does not reach you. Do not fix one by changing the other.

## Checking what a caller actually holds

`GET /api/v2/{scope}/me/whoami` returns the resolved list in
`identity.permissions[]`. That is the union of both layers, post-cache, as the
API will use it on the next request. It is the only honest answer to "what can
this person do" — do not infer it from `defaults.json` alone, because layer 2
may have widened it.
