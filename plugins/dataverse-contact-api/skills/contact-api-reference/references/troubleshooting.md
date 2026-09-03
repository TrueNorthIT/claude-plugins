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
| `401` on everything | Token rejected — wrong audience, wrong issuer, expired, or an ID token sent instead of an access token | Compare the token's `aud`/`iss` with `idp_audience`/`idp_issuer` from `/.well-known/oauth-protected-resource` |
| `403 Missing required permission: <route>` on **every** route including reads | The scope has **no published `defaults.json`** | Publish defaults. In Terraform, apply `permissions_sync` |
| `403 Missing required permission: <subj>:write:team` | You hold `<subj>:write`, which is tier `me` and never implies `team` | Grant `<subj>:write:team` explicitly — see `permissions.md` |
| `403` that persists after a grant | The 5-minute permission cache | Wait it out. Confirm with `whoami`, which shows the resolved list |
| `404` on `/me/*` and `/team/*`, but `/all/*` works | Authenticated with no matching Dataverse contact | Check `contact.emailaddress1` against the sign-in email — see `auth.md` |
| `404` on one `{id}` that you know exists | The row exists but the join does not reach you at that tier | Try the same id at `team`, then `all`. If `all` finds it, it is a join question, not a data question |
| `400 Use the cursor from 'page.next'` | A `skip` parameter | Follow `page.next` verbatim; there is no offset paging |
| `400` with a "did you mean" hint | A misspelled field in `select` / `filter` / `orderBy` / `expand` | Take the suggestion, or list the real fields with `/{scope}/schema?table={table}` |
| `405` on a create | `POST` to a tier other than `me` | `POST /me/{table}` is the only create route |
| Sign-in fails at the Microsoft page, never reaches the app | `AADSTS50011` — redirect URI mismatch, usually a trailing slash | Make the app registration and the client config byte-identical. No trailing slash |
| A list returns `200` and **zero rows**, no error | The join path does not reach any rows | See below — this is its own diagnosis |
| A stale value after an update | Check `X-Cache` on the response | A `HIT` is the explanation |

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
| `X-Cache: HIT\|MISS` | A response looks stale |
| `X-Data-Source: lake` | Data is behind live Dataverse |
| `X-Deprecated-Field` | Any time — it is free warning of a future break |

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
