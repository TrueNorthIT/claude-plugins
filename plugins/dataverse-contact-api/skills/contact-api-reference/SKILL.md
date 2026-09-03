---
name: contact-api-reference
description: How the Dataverse Contact API works, for anyone writing or debugging a client against it — the /api/v2/{scope}/{tier}/{table} URL shape, the me / team / all / public tiers, which verbs exist on which routes (there is no DELETE), the permission string grammar and what it does and does not imply, the non-OData query dialect (select / top / orderBy / filter / expand, cursor paging), Entra External ID auth and email-claim contact resolution, the @truenorth-it/dataverse-client SDK, and the whoami-first triage for 401 / 403 / 404 / an empty list. Use when the user asks how the Contact API works, what a route returns, why a call is 403 or 404 or empty, how to filter or page or sort, how to authenticate a portal against it, what permission string to grant, or how to call it from TypeScript.
---

# contact-api-reference

The Dataverse Contact API puts a **citizen-facing** HTTP surface in front of
Microsoft Dataverse. A signed-in person gets their own rows, and only their own
rows, without the client ever sending a filter that could be tampered with. The
API resolves the caller to a Dataverse contact, rewrites every query to join
back to that contact, and enforces a permission string on every route.

This skill is the factual reference for that API: what the URLs are, what the
responses look like, and what the error you just got actually means. It does
not scaffold anything — see the sibling skills below for that.

## The URL shape

```
/api/v2/{scope}/{tier}/{table}[/{id}]
```

| Segment | What it selects |
|---|---|
| `{scope}` | The API partition — `default`, `helpdesk`, `fcc`, … Each scope has its own OIDC audience, its own Dataverse credentials and its own set of published tables. Two scopes on one deployment share nothing. |
| `{tier}` | How rows are scoped to the caller: `me`, `team`, `all` or `public`. |
| `{table}` | The route name the scope publishes — usually, but not always, the Dataverse logical name. |

### The four tiers

| Tier | Rows returned | Auth |
|---|---|---|
| `me` | Rows reachable from the caller's contact along the table's `contactJoinPath`. `alternateContactJoinPaths` are OR'd in, so a row qualifies if **any** path reaches it. | Token + a matching Dataverse contact |
| `team` | Rows reachable along `teamJoinPath` — typically the caller's account, i.e. their colleagues' rows. | Token + a matching Dataverse contact |
| `all` | Every row in the table. No join is applied. | Token only — no Dataverse contact required |
| `public` | Read-only, unauthenticated. Only for tables published with `publicRead: true`. | None |

**`me` is not `ownerid`.** It is a declared join path, configured per table. A
row you "own" in Dataverse is invisible at `me` if the join path does not reach
it, and a row you have never touched is visible if it does. When a `me` list
comes back empty, the join path is the first thing to check — not the data.

## The verb matrix

What is *absent* here matters as much as what is present:

| Verb | Path | Permission required |
|---|---|---|
| `GET` | `/{tier}/{table}` | `<subj>` / `<subj>:team` / `<subj>:all` |
| `POST` | `/me/{table}` | `<subj>:create` — **`me` only. Other tiers answer 405.** |
| `GET` | `/{tier}/{table}/{id}` | the tier's read permission |
| `PATCH` | `/{tier}/{table}/{id}` | `<subj>:write` / `:write:team` / `:write:all` |
| `GET` | `/{tier}/lookup/{table}?search=` | `<subj>:lookup[:team\|:all]` |
| `GET` | `/{tier}/aggregate/{table}?aggregate=count&groupBy=` | the tier's read permission |
| `GET` | `/{tier}/changes/{table}?deltaToken=` | the tier's read permission |
| `GET` | `/{scope}/me/whoami` | a valid token |
| `GET` | `/{scope}/schema[?table=]`, `/{scope}/openapi.json` | none |
| `GET` | `/{scope}/choices/{table}[/{field}]` | any permission on that subject |
| `GET` | `/api/v2/_admin/scopes` | none — and note `_admin` comes **before** the scope |
| `GET` | `/api/v2/_admin/{scope}/table-manager/defaults` | `admin:{scope}` |

**There is no `DELETE` anywhere on the data tier.** Record routes allow `GET`
and `PATCH` only; list routes allow `GET` and `POST` only. Deactivating a row is
a `statecode` write, not a delete — and for `incident` even that does not work
as a plain `PATCH`, because Dataverse requires the `CloseIncident` action. Do
not design a UI with a delete button and expect the API to grow one.

## Reference files

Load on demand, not upfront. Each is self-contained.

| When you are doing this | Read |
|---|---|
| Deciding or debugging what a caller is allowed to do | `references/permissions.md` |
| Writing a list query — filtering, sorting, paging, expanding | `references/querying.md` |
| Wiring sign-in, or a token is being rejected | `references/auth.md` |
| Calling the API from TypeScript | `references/sdk.md` |
| Anything beyond the common routes — envelopes, headers, choices, changes, aggregate | `references/routes.md` |
| A call is failing and you need to work out why | `references/troubleshooting.md` |
| Administering scopes, tables or per-user grants | `references/admin.md` |

## The five things that catch people out

Each is expanded in a reference file; these are the ones worth knowing before
you write a line of client code.

1. **`case:write` does not satisfy `case:write:team`.** Tiers imply *downwards*
   only, and only within the same operation. Write never implies read.
   → `references/permissions.md`
2. **The query dialect is not OData.** No `$` prefix, `filter` is
   space-separated `field operator value`, and `skip` is rejected outright —
   paging is cursor-based via `page.next`. → `references/querying.md`
3. **The caller is matched to a contact by the lowercased `email` claim**, not
   `oid` and not `sub`. No matching contact means the token is fine and `/me`
   still 404s. → `references/auth.md`
4. **A scope with no published `defaults.json` grants nothing** — every route,
   reads included, answers `403 Missing required permission: <route>`. This is
   the single most common reason a freshly created scope appears dead.
   → `references/permissions.md`
5. **Permissions are cached for 5 minutes.** A grant you just made is not live
   yet. Do not debug through that window.

## First call against an unfamiliar deployment

In order, because each step tells you whether the next is worth attempting:

```bash
# 1. Which scopes exist? (public, no auth)
curl -s "$API_URL/api/v2/_admin/scopes"

# 2. What does this scope publish, and with what fields? (public, no auth)
curl -s "$API_URL/api/v2/$SCOPE/schema" | head -c 2000

# 3. Who does my token say I am, and did it find a contact?
curl -s -H "Authorization: Bearer $TOKEN" "$API_URL/api/v2/$SCOPE/me/whoami"

# 4. Only now, a real query.
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/v2/$SCOPE/me/case?top=5&orderBy=createdon:desc"
```

Step 3 is the important one. `whoami` is deliberately tolerant — it answers
`200` for a valid token even when no Dataverse contact matches, and returns the
resolved permission list. It separates "the token is wrong" from "the token is
fine but nothing links me to a contact", which are the two failures that look
identical from a `404`. See `references/troubleshooting.md`.

`/{scope}/schema` is also the right readiness probe. `/health` and
`/cache-stats` exist only on the container deployment, not on the Vercel
serverless one.

## Related skills

This skill is the shared factual layer. It deliberately does not repeat the
procedures in its siblings:

| For | Use |
|---|---|
| Defining a scope's tables, joins and baseline permissions as Terraform | the `dataverse-terraform` plugin |
| Scaffolding a React portal against a scope | the `dataverse-portal` plugin |

If the user is asking *how to configure* a scope, hand off. If they are asking
*how the thing behaves* — what a route returns, why a call failed, what a
permission string means — answer here.
