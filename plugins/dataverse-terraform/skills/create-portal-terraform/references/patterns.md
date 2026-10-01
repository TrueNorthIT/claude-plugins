# Modelling patterns

How to decide what a route's Terraform should say. Every pattern here is drawn
from a live portal running on the Contact API.

## Row scoping is the whole job

The API never trusts a caller to filter their own rows. Each route declares how
its rows join back to the signed-in person, and the API rewrites every query
accordingly:

| Tier | Meaning | Declared by |
|---|---|---|
| `me` | Rows belonging to the caller's own contact | `contact_join_step` |
| `team` | Rows belonging to anyone at the caller's account | `team_join_step` |
| `all` | Every row in the table | neither — it opts out of scoping |

Getting the join right is what makes `["me"]` safe. Reaching for `["all"]`
because a join was hard is how a portal leaks another customer's data.

### The trivial joins

A contact route joins to itself; an account route joins through its primary
contact:

```hcl
# on the contact route — "me" is the row itself
contact_join_step {
  table = "contacts"
  from  = "contactid"
  key   = "contactid"
}

# on the contact route — "team" is everyone under the same account
team_join_step {
  table = "accounts"
  from  = "parentcustomerid_account"
  key   = "accountid"
}
```

### Multi-hop joins

Steps are ordered; each walks from the current table to the next. A case owned
by a contact is one hop (`customerid` → `contacts`). A project task owned via
its project is two.

### Ownerless children need a reverse join

Some tables have no per-person owner at all — a venue slot, an order line, an
uploaded file. There is no contact column to scope by, so the child is hung off
an **owned parent** and the parent governs it.

On the child route, the first step walks the parent's collection-valued
navigation property **backwards** (`reverse = true`), then continues forward to
the contact. The API compiles this to an OData `any()` lambda:

```hcl
# booking ← servicebooking → contact
contact_join_step {
  table   = "tn_citizenservicebookings"
  from    = "tn_booking_csb"   # collection nav (relationship schema name)
  key     = ""
  reverse = true
}
contact_join_step {
  table = "contacts"
  from  = "tn_Citizen"
  key   = "contactid"
}
```

Do **not** give an ownerless child `["all", "write:all"]` to work around its
missing owner. The reverse join lets it stay `["me", "write"]`.

Then prove it filters. A route that returns the whole table looks exactly like
one that is scoped, right up until somebody else's rows turn up:

```bash
contact-admin tables test-query <route> --tier me --contact-id 3f2a8c1e-0000-4000-8000-000000000000
```

A contact id that matches nobody must get nothing back. Rows mean the route is
returning the table, not the caller's slice of it — fix that before granting it
to anyone.

### Creating an ownerless child

The parent carries a `create_default` binding the caller, plus an `expand` for
the lookup that points at the child:

```hcl
create_default {
  field      = "tn_Citizen"
  bind_to    = "contact"
  entity_set = "contacts"
}

expand {
  lookup_field  = "tn_Booking"
  related_table = "bookableresourcebooking"
  field { name = "starttime", type = "datetime", description = "Slot start" }
}
```

The citizen then `POST`s the parent with the child nested inside it. The API
authorises against the **parent's** `create` permission, so the child needs no
`create` permission and no join path of its own for that write.

Read that the other way round too: an `expand` from a parent into a child lets
anyone who can create the parent create that child, whatever the child route
is granted. Only expand into children citizens may create. The nested body is
validated against the **child** route's `fields`, so that is where to restrict
it: writable only what a citizen may set at creation (a booking's start time,
the resource they picked), `read_only` for everything else. A lookup the child
genuinely needs stays writable — `read_only` would drop it on create too — so
give it a `lookup_table`.

Generic shape: **Order → OrderLine**. The order is customer-owned; the line is
not.

## Permissions

`default_permissions` is the baseline every caller gets; per-user grants in
`cpa_apipermission` are unioned on top at request time. "Every caller" means
every token the scope accepts:

- **callers with no Dataverse contact** — refused at `me` and `team`, which need
  one, but not at `all`, which doesn't;
- **users of every other portal on the deployment**, unless this scope sets its
  own OIDC audience — one token works across all scopes that share one;
- **anyone at all**, where the identity provider allows self-service sign-up.

So `all`, and every action ending in `:all` — `write:all`, `lookup:all`,
`invoke:all` — never go in `default_permissions`. `case = ["all"]` there hands
every case to anyone who can create an account, and `invoke:all` reduces an
`ownershipCheck` to "the record exists". Unscoped access belongs to named staff,
as per-person grants.

Defaults are keyed by route name, so they apply the moment a route by that name
is published — including a route added to an existing scope whose defaults
already mention it. (A key that names a `permission_group` but no route grants
nothing.)

```hcl
default_permissions = {
  contact = ["me", "write"]                     # edit your own profile
  account = ["me", "team"]                      # read-only
  case    = ["me", "team", "write", "create"]   # raise and update your own
}
```

Read tiers are `me` / `team` / `all`; each of `write`, `create`, `lookup` and
`invoke` has plain, `:team` and `:all` variants. An unrecognised action is
rejected when the defaults are published — the apply fails with a 400 naming
it, rather than publishing a broken scope. (A typo in a per-person
`cpa_apipermission` string is not caught at all: it silently grants nothing.)

**`team` is only as narrow as the account model.** It means every row reachable
from the caller's account. In a business portal that is their colleagues; in a
citizen portal whose contacts were bulk-loaded under one catch-all account, it
is every citizen. Check how contacts are parented before granting `team`.

**A grant never promotes itself to a higher tier.** Permission strings parse as
`<subject>[:<operation>][:<tier>]`, so a bare `case:write` is tier `me`. The
implication engine matches on subject and only ever lets read imply lookup —
write and create imply nothing. So holding `case:write` can never produce
`case:write:team`, and `PATCH /team/case/{id}` returns `403` from the server
whatever the frontend does.

That asymmetry is usually the point rather than a limitation, and it is worth a
comment in the config wherever it is load-bearing. **Read your colleagues'
records, edit only your own** is expressed entirely by granting `write` and
withholding `write:team`. It is not a UI decision, and a portal that enforces
it in React alone has not enforced it.

### Sharing a permission between routes

Notes attached to cases shouldn't need their own permission. Give the child
route a `permission_group` and leave it out of `default_permissions`:

```hcl
resource "dataversecontact_table" "casenotes" {
  route_name       = "casenotes"
  required_permission = "casenotes"
  permission_group = "case"   # inherits whatever `case` was granted
  # …
}
```

"Whatever `case` was granted" includes every per-person grant on the `case`
subject, `case:all` and `case:write:team` among them. Put a child in a group
only if everyone who may see the parent may see the child — staff-only notes do
not qualify.

### The public tier

`public_read` puts a route on the unauthenticated tier — right for a knowledge
base or a service catalogue, and it needs no entry in `default_permissions` at
all. `public_create` allows unauthenticated POST, which is how an anonymous
"report it" form works. Both default to `false`; turn them on deliberately, and
know what each hands out:

- **`public_read`** — every column in `fields`, not just `default_select` (a
  caller can `select` and `filter` on any of them), every configured `expand`,
  and every row the route's `filters` allow, by paging. Put only columns in
  `fields` that you would print on a public web page.
- **`public_create`** — anonymous inserts. With no caller, `create_default`
  binds nothing and lookups aren't checked against anyone's rows, so the
  anonymous caller sets every writable field. Give the route no writable lookups
  and no writable join-path columns — otherwise anyone can attach a record to a
  contact of their choosing — and a short `default_select`, because the 201
  echoes the row. It doesn't need `public_read`.
- **Neither has rate limiting.** The API does none of its own. A public route
  needs rate limiting or a WAF at the edge; a CAPTCHA in the portal protects
  nothing, because the endpoint can be called without the portal.

## Self-service sign-up

Three settings on `permissions_sync` decide whether a stranger who signs in can
become a customer:

```hcl
allow_self_register = true

company_model = { strategy = "parent-account" }

join = {
  strategy      = "domain-list"
  domain_field  = "new_portaldomains"
  require_match = true
}
```

- `allow_self_register` — a signed-in caller with no Dataverse contact can
  provision one via `POST /me/register`, with the email from their token, and
  holds `default_permissions` from that moment. Anyone who can create an
  account at the identity provider can do this.
- `company_model` — how a person resolves to the companies they may act as.
  `parent-account` is the classic model (one contact per company).
  `associated-accounts` is for one contact linked to several companies, and
  needs `associated_accounts = { relationship = "…" }` or a `fetch_xml`.
- `join` — how a new user is matched to a company. `domain-list` compares their
  email domain, exactly, against a column on each account. With
  `require_match = true`, a domain on no company is refused sign-up entirely;
  with `false` they get an unlinked contact for staff to link later — fine only
  if an unlinked contact holding just the defaults can't reach anything it
  shouldn't.

The `domain_field` column is now an access-control list: whoever can edit it
decides who may join that company. Keep it staff-maintained and `read_only` (or
absent) on every route, including the account route. Never put a shared or
consumer domain in it. The API refuses a short built-in list (gmail.com,
outlook.com, icloud.com and the like), but treats anything else — an ISP's
domain, a regional mail provider's — as a company's own.

The email the domain comes from is the token's email claim, which the API takes
on trust. The identity provider must only issue verified addresses there; Entra
External ID's email sign-up does.

## Field-level gotchas

**Polymorphic navigation properties are not fields.** `customerid` on a case
and `parentcustomerid_account` on a contact are navigation properties, not
scalar columns. Use them in `team_join_step` and `expand`, but do **not**
declare them in `fields` — the API drops them, and the provider then reports a
state-consistency error on apply.

**`read_only` is the default posture.** Anything a citizen shouldn't PATCH —
identifiers, status codes, `createdon`, computed names — gets
`read_only = true`. Only genuinely editable columns stay writable. The API drops
a read-only column silently, from create as well as PATCH, so there is no
"settable on create only"; for anything that decides status or ownership,
choose read-only.

**Identity and ownership columns are never writable.** These decide who a caller
*is* and whose a row is, so a writable one is a way to change either:

| Column | Writable, it lets the caller… |
|---|---|
| `emailaddress1` on the contact route | move the key the API matches their sign-in to. With `write:team` or `write:all` on contacts, set a colleague's address to their own and sign in as them |
| the company link (`parentcustomerid`) | move themselves into another company's `team` |
| any column a join step follows | change whose a row is |
| the field a `create_default` binds | re-point it after create — the default applies on create only |
| `join.domain_field` on account | decide who may self-register into that company |

Keep `write:team` and `write:all` on the contact route out of
`default_permissions` entirely.

**Every writable lookup needs a resolvable `lookup_table`.** On `me` and `team`
writes the API checks that the row a lookup points at belongs to the caller —
but only when `lookup_table` names a route this scope publishes, with a join
path for that tier. A lookup without one is written unchecked. And `write:all`
is unscoped here too — there is no check on that tier, so whoever holds it can
point a lookup at any row.

**`fields` is the exposure.** Anyone who can read a route can `select` and
`filter` on every column in `fields`, whatever `default_select` says — on
`public_read` routes too, and even a `lookup`-only grant can filter on them to
infer what it can't select. Declare what the portal shows or writes and nothing
else: no internal notes, risk or safeguarding flags, staff-only comments.

**`description` is API documentation.** It is what a developer (or a model
scaffolding a UI) sees when discovering the route. "Case title" is useful;
"title" is not.

**`default_select` is what a caller gets when it sends no `?select`.** A
caller's own `?select` wins on every route, single-record `GET` included (only a `fetch_xml` list ignores it), so
`default_select` decides only the no-argument case — which is the case a detail
page usually hits. Leave a column out and the list looks correct while the
detail view comes back with that field empty, which reads as a data problem
rather than a config one. Put everything the default request depends on in it,
long text columns included. A live route's `defaultFields` is a list tuned for
*its* UI, not yours: `case` omits `description` for exactly this reason, so
copying it wholesale imports the bug. Never leave it as `[]`: an empty list is
read as "no projection", not "no columns".

**An `expand` is as exposed as its parent.** It returns its `field` blocks from
whatever row the lookup points at, with no join or filter of its own, on every
tier including `public`. Expanding `ownerid` to a staff member's name may be
fine; their email address is published to every caller who can read the
parent. Always list the fields — an expand with none returns the whole related
row.

**`fetch_xml` replaces the join steps and `filters`** on the list endpoint. Rows
are scoped only by `{{contactid}}` / `{{accountid}}` placeholders inside the
template, and the caller's `select` and `filter` are ignored. A template with
no placeholder returns the same rows on `me`, `team`, `all` and `public` —
whatever join steps the route also declares. Reach for it only when a join
can't express the query, and review it as a security change.

**A child route sees everything its join reaches.** Notes or activities joined
through the case return every note on the case, including the ones staff wrote
for each other, and `write` on that route lets a citizen edit them. Filter the
route to what is meant for the customer if the organisation marks it, grant
`create` rather than `write`, or don't publish it.

**`filters` defaults to `["statecode eq 0"]`** — active rows only, and it is
invisible in a config that does not mention it. Override it with an explicit
`filters = []` and a comment whenever closed records must stay readable: a help
desk where a resolved ticket still has to open, or the rcportal opportunity
route. Inheriting the default silently hides half the data.

**`lookup_search_contains`** switches a lookup column from `startswith` to
`contains` matching. Set it explicitly on every route (`[]` when unused) — the
provider reads it back as an empty list rather than null, so leaving it out
produces a permanent one-line diff.

## Ordering and re-publishing

`permissions_sync` must apply **after** every route it references. Wire it with
both `depends_on` and a `triggers` hash so a changed table definition forces the
defaults to be re-published:

```hcl
triggers = {
  routes_hash = sha256(join(",", [
    dataversecontact_table.contact.id,
    dataversecontact_table.case.id,
  ]))
}

depends_on = [
  dataversecontact_table.contact,
  dataversecontact_table.case,
]
```

The API validates `defaults.json` against the routes it knows about, but
tolerates unknown route names with a warning — a defaults document may be
published just ahead of its table.

## The security pass — every route, before every apply

The API enforces exactly what this config says, on every request. So a scope
can plan cleanly, apply cleanly, work in the portal and still leak. Before
applying a new route, or a change to one, check:

| # | Check | Fails as |
|---|---|---|
| 1 | No `all`, and no action ending in `:all`, in `default_permissions` | Every row, to anyone who can sign in |
| 2 | `team` granted only where the account model really groups colleagues | Every citizen's rows, under a catch-all account |
| 3 | `fields` holds only what the portal shows or writes | Internal columns, selectable by every reader |
| 4 | Identity and ownership columns `read_only`: `emailaddress1`, the company link, join-step columns, `create_default` fields, `join.domain_field` | A caller changing who they are or whose a row is |
| 5 | Every writable lookup has a `lookup_table` this scope publishes | Lookups pointed at other people's rows, unchecked |
| 6 | `default_select` not empty; every `expand` lists its fields, none revealing more than the parent should | Whole rows, or staff details, returned |
| 7 | No `fetch_xml`, or one scoped by `{{contactid}}` / `{{accountid}}` | The same rows for every caller |
| 8 | Notes and activities filtered to what the customer should see, granted `create` not `write` | Staff-only notes shown to, and editable by, the customer |
| 9 | `permission_group` only where the parent's audience may see the child | The child opened to every grant on the parent |
| 10 | `public_read` / `public_create` only where anonymous use is the point; `public_create` routes with no writable lookups | Data on the open internet; records attached to strangers |
| 11 | Custom APIs: `publicInvoke` only for read-only data anyone may see; an `ownershipCheck` on anything acting on a record | Anonymous actions; actions on other people's records |
| 12 | Self-registration: `domain_field` staff-only and free of shared domains | Strangers joining a company |

After the apply, run the negative test for each new route:
`contact-admin tables test-query <route> --tier me --contact-id <a GUID matching
nobody>` must return no rows.

Defence in depth: the API reads Dataverse as one application user per scope.
Give it a security role covering what the scope's routes need rather than
System Administrator, so a route published by mistake can only reach what that
role allows.
