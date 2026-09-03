# Triage

## Start with `whoami`

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/v2/$SCOPE/me/whoami" | jq
```

It is the single best diagnostic on the API, because it is deliberately
tolerant: it answers 200 wherever it possibly can, and tells you three things at
once — whether the token is valid, whether a contact was found, and what
permissions resolved.

| `whoami` says | Conclusion |
|---|---|
| `401` | The token is bad. Nothing else is worth checking yet |
| `200`, `dataverseContact: null` | Token fine, no contact matches the email claim. `/me` and `/team` will 404 |
| `200`, contact present, `permissions: []` | Authenticated, authorised for nothing — almost always missing published defaults |
| `200`, contact present, permissions look right | The problem is the specific route, the join, or the query |

Do not skip this step to go straight to the failing call. Half the failure modes
below are indistinguishable from each other at the call site and obvious in
`whoami`.

## The triage table

| Symptom | Cause | Fix |
|---|---|---|
| `401 Missing or malformed Authorization header` | No `Bearer` prefix, or no header at all | Check the client is attaching the token, not just acquiring it |
| `401 Token has expired` / `Invalid token` / `Token validation failed: …` | Wrong audience, wrong issuer, or an **ID token sent instead of an access token** | Compare the token's `aud`/`iss` with `idp_audience`/`idp_issuer` from `/.well-known/oauth-protected-resource` |
| `401 Token does not contain an email claim` | The IdP is not emitting `email` in access tokens | Fix claims mapping on the app registration, or set the scope's `OIDC_EMAIL_CLAIM` |
| `403 Missing required permission: <subject>` on **every** route including reads | The scope has **no published `defaults.json`** | Publish defaults. In Terraform, apply `permissions_sync` |
| `403 Missing required permission: <something>` naming a subject that is not the route you called | The route declares a `permissionGroup`, so its subject is the group name | Grant the string in the message. Confirm with the `permission` field on `/{scope}/schema` — see `permissions.md` |
| `403 Missing required permission: <subj>:write:team` | You hold `<subj>:write`, which is tier `me` and never implies `team` | Grant `<subj>:write:team` explicitly — see `permissions.md` |
| `403` that persists after a grant | The 5-minute permission cache | Wait it out. Confirm with `whoami`, which shows the resolved list |
| A grant that appears to do nothing at all | A misspelled operation — an unknown one is absorbed into the subject silently | Check it against `write` / `create` / `lookup` / `invoke` |
| `404 No Dataverse contact found for …` on `/me/*` and `/team/*`, while `/all/*` works | Authenticated with no matching Dataverse contact | Check `contact.emailaddress1` against the sign-in email — see `auth.md`. The message ends with the email, so match on the prefix |
| `404 Table "X" does not support /me access. Use /all/X instead.` | The route declares no contact join path | A configuration fact, not a permission. No grant will change it |
| `404 No company account is available for team access…` | No account on the contact, or no `X-Company-Id` selected | The message names both models; supply whichever input is missing |
| `404` on one `{id}` that you know exists | The row exists but the join does not reach you at that tier | Try the same id at `team`, then `all`. If `all` finds it, it is a join question, not a data question |
| `400 Invalid pagination state. Use the cursor from 'page.next'…` | A `skip` without a cursor | Take the cursor from `page.next`; there is no offset paging |
| Page 2 returns rows page 1 filtered out, or is missing fields page 1 had | `page.next` carries only `top`, `cursor` and `orderBy` | Re-append your `select` / `filter` / `filterLogic` / `expand` to it — see `querying.md` |
| `400 Cannot filter by unknown field …` | A misspelled field in `select` / `filter` / `orderBy` / `expand` | Take the "did you mean" suggestion, or list the real fields with `/{scope}/schema?table={table}` |
| `400 Operator 'contains' is not valid for choice field …` | Wrong operator for the field's type | The message names the allowed set |
| `405 Method not allowed` on a create | `POST` to `team` or `all` | Create is `me`-only. Do not read `Access-Control-Allow-Methods` — it advertises the POST the route just refused |
| `405 Public access is read-only` | `POST /public/{table}` on a table that does not set `publicCreate` | Not fixable from the client. Public create is a per-table opt-in — see `routes.md` |
| `405 Lake-backed tables are read-only` | Any write on a lake-served route | Not fixable from the client |
| `405 Custom API "X" is a function — use GET, not POST` | Wrong verb on `/public/actions/{name}` | `GET` for functions, `POST` for actions |
| `401` on `/public/actions/{name}` | The path says `public` but the action is not `publicInvoke` | Send a bearer token; the caller also needs a resolved contact and `{name}:invoke` |
| Sign-in fails at the Microsoft page, never reaches the app | `AADSTS50011` — redirect URI mismatch, usually a trailing slash | Make the app registration and the client config byte-identical. No trailing slash |
| A list returns `200` and **zero rows**, no error | The join path does not reach any rows | See below — this is its own diagnosis |
| Only 100 rows come back when you asked for 500 | `top` is clamped to 100 silently, not rejected | Page with `page.next`, re-appending your query options as above |
| `_label` fields missing | `X-Data-Source: lake` — lake-backed routes get no label enrichment | Read the raw value, or serve the route from live Dataverse |

## The empty list: two very different failures

An empty `me` list is ambiguous, and the distinction matters:

| What you see | What it means |
|---|---|
| `200`, `data: []`, **no error at all** | The query ran. Dataverse was asked, correctly, and answered nothing. The **join field is wrong** — `contactJoinPath` points somewhere that does not reach this caller's rows. The API is behaving exactly as configured; the configuration is what is wrong |
| A Dataverse error surfaced through the API | The **join config is malformed** — a column that does not exist, a bad relationship name, a broken navigation property. The query could not even be built |

A clean empty list is not "no data". Prove it by asking at `all`: if `all`
returns rows and `me` does not, the rows exist and the join is the problem. If
`all` is also empty, there genuinely is nothing there.

Once you suspect the join, verify it without a portal:

```bash
contact-admin tables test-query <route> --tier me --contact-id <guid>
```

That runs the configured join for a specific contact and shows what comes back —
far faster than round-tripping through a UI and a sign-in. See `admin.md`.

## 403 or 404 — which question are you answering

They are never the same fix:

- **403 is about the permission list.** The route refused before it looked at
  any data. Change what the caller is granted.
- **404 is about the join.** The caller was allowed to ask; the row did not
  reach them, or no contact resolved at all. Change the join path, or the
  contact record.

Widening a permission to fix a 404 makes the portal less safe and leaves the bug
in place.

## Headers worth logging

| Header | Read it when |
|---|---|
| `x-correlation-id` | **Always.** Present on every response; it is what support needs to find your request in the logs |
| `X-Cache: HIT\|MISS` | A response looks stale. Note this header only appears when the response cache is enabled, which it is **not** by default — its absence is not evidence of a cache miss |
| `X-Data-Source: lake` | Data is behind live Dataverse, or `_label` fields are missing |
| `X-Deprecated-Field` | Any time — free warning of a future break, in `old=>new` form |

## Probing a deployment

`/health` and `/cache-stats` exist **only on the container deployment**, not on
Vercel serverless. A monitor pointed at `/health` will show a healthy Vercel
deployment as down.

Use this instead, everywhere:

```bash
curl -sf "$API_URL/api/v2/$SCOPE/schema" > /dev/null && echo up
```

No credentials, present on every deployment, and a 200 additionally proves the
scope's configuration loaded — which a generic health check would not.
