# Explaining a Contact API Terraform config

How to read a scope's `main.tf` back to a human. The audience is usually one of
three people, and they want different things:

| Audience | Wants to know |
|---|---|
| Reviewer on a PR | What changed, and whether it widens who can see what |
| Colleague inheriting the repo | What this portal exposes, route by route |
| Customer or delivery lead | What citizens can do, and what happens on apply |

Lead with the security boundary. In this API, a route's join path *is* the
access control — everything else is detail.

## Reading a route

For each `dataversecontact_table`, answer five questions in this order:

1. **What is it?** `dataverse_table` is the Dataverse entity set; `route_name`
   is the URL. `case` fronting `incidents` means `GET /me/case` reads incidents.
2. **Whose rows are these?** Read `contact_join_step` / `team_join_step` as a
   chain and say it in English. Each step names the table it walks *to* and the
   column it follows (`from`).
3. **What can be read?** `fields` is the exposed surface; `default_select` is
   what comes back by default. Anything absent from `fields` does not exist as
   far as a caller is concerned.
4. **What can be written?** Fields *without* `read_only`. Plus `create_default`,
   which silently binds the caller on create — worth calling out, because it is
   how a record becomes "theirs".
5. **Who is allowed?** The route's entry in `default_permissions`, or its
   `permission_group` parent, or `public_read` — see below.

### Turning a join path into a sentence

Read the steps in order; each hop is "follow `from` to `table`".

```hcl
contact_join_step { table = "contacts", from = "customerid", key = "contactid" }
```

> A case is yours if its `customerid` points at your contact record.

```hcl
contact_join_step { table = "msdyn_projects", from = "msdyn_project", key = "msdyn_projectid" }
contact_join_step { table = "contacts",       from = "msdyn_contact", key = "contactid" }
```

> A task is yours if it belongs to a project whose contact is you.

A step with `reverse = true` walks a collection backwards — the row has no owner
column of its own, so it inherits ownership from the parent that points at it:

> A booking is yours if some service booking of yours points at it.

## The permission vocabulary, in plain words

| Token | Says |
|---|---|
| `me` | Read rows that join back to you |
| `team` | Read rows that join back to anyone at your company |
| `all` | Read every row in the table |
| `write` / `create` | Modify or add, at the matching scope (`:team`, `:all`) |
| `lookup` | Use the type-ahead route |
| `invoke` | Call a custom API |

A route with no entry at all is not readable — unless it has a
`permission_group` pointing at a route that does have one, or `public_read`.
Say which of the three applies; a reader cannot tell by looking at the route in
isolation.

## What to flag, every time

These are the lines that change the blast radius. Call them out explicitly,
even when they are correct and intentional:

| Construct | Why it matters |
|---|---|
| `all` or `write:all` | The route ignores row scoping entirely — every caller sees every row |
| `public_read = true` | Unauthenticated. Anyone on the internet can read it |
| `public_create = true` | Unauthenticated POST. Anyone can insert rows |
| no `contact_join_step` on a route granted `me` | The scoping cannot work; expect empty results or an error |
| `filters = []` | Clears the `statecode eq 0` default — closed and inactive records become visible |
| `allow_self_register = true` with `require_match = false` | A stranger who signs in gets an unlinked contact |
| `join.require_match = true` | Sign-up is gated on email domain matching a company |
| `create_default` | Records created here are silently bound to the caller |
| an `invoke` grant on a custom API that isn't `publicInvoke` | Dead config — custom APIs are only routed on the public tier, so nothing authorises against that grant |
| a mutating custom API with no `ownershipCheck` | Nothing ties the call to the caller's own records |
| a field without `read_only` | The citizen can PATCH it — check that is intended for status, owner and identifier columns |

## Explaining what an apply will do

People new to Terraform ask what it will actually touch. The honest answer for
this provider:

- **Everything it writes goes to the Contact API's config layer**, never to
  citizen data. Applying republishes table definitions and a `defaults.json`
  blob. It does not create, modify or delete a single Dataverse row.
- **Each table resource saves a draft and publishes it in one step.** There is
  no separate publish action to remember.
- **A change is live once the registry cache turns over**, not necessarily the
  instant apply returns.
- **`terraform destroy` permanently deletes route definitions.** It unpublishes,
  recycles *and* permanently deletes each route — there is no recycle-bin copy
  to restore from afterwards. The Dataverse tables and their data survive; the
  published schema does not, and only a re-apply brings it back.
- **State holds no secrets** beyond the config itself — the connection key is a
  provider argument, supplied per run from `.env`.
- **The riskiest single line is a permission**, not a schema. Widening `me` to
  `team`, or adding `public_read`, changes who can see other people's records
  the moment it applies.

## Suggested shape for the explanation

Keep it skimmable. A useful write-up runs:

1. One paragraph: what this scope is for, how many routes, sign-up posture.
2. A table of routes — route, Dataverse table, who can read, who can write.
3. The security boundary: each route's join in one sentence.
4. Anything on the flag list above, with a note on whether it looks deliberate.
5. What applying would do, if the user is about to run it.

Quote the specific `main.tf` lines you are describing. An explanation that
cannot be traced back to a line is a guess, and this is exactly the material
where a plausible guess is worse than a gap.
