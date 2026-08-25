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

Generic shape: **Order → OrderLine**. The order is customer-owned; the line is
not.

## Permissions

`default_permissions` is what every authenticated caller gets. Per-user grants
in `cr_apipermission` are unioned on top at request time.

```hcl
default_permissions = {
  contact = ["me", "write"]                     # edit your own profile
  account = ["me", "team"]                      # read-only
  case    = ["me", "team", "write", "create"]   # raise and update your own
}
```

Read tiers are `me` / `team` / `all`; each of `write`, `create`, `lookup` and
`invoke` has plain, `:team` and `:all` variants. An unrecognised action fails
scope load — a typo takes the whole scope down, not just one route.

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

### The public tier

`public_read` puts a route on the unauthenticated tier — right for a knowledge
base or a service catalogue, and it needs no entry in `default_permissions` at
all. `public_create` allows unauthenticated POST, which is how an anonymous
"report it" form works. Both default to `false`; turn them on deliberately.

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
  provision one via `POST /me/register`.
- `company_model` — how a person resolves to the companies they may act as.
  `parent-account` is the classic model (one contact per company).
  `associated-accounts` is for one contact linked to several companies, and
  needs `associated_accounts = { relationship = "…" }` or a `fetch_xml`.
- `join` — how a new user is matched to a company. `domain-list` compares their
  verified email domain against a column on each account. With
  `require_match = true`, a domain on no company is refused sign-up entirely;
  with `false` they get an unlinked contact for staff to link later.

## Field-level gotchas

**Polymorphic navigation properties are not fields.** `customerid` on a case
and `parentcustomerid_account` on a contact are navigation properties, not
scalar columns. Use them in `team_join_step` and `expand`, but do **not**
declare them in `fields` — the API drops them, and the provider then reports a
state-consistency error on apply.

**`read_only` is the default posture.** Anything a citizen shouldn't PATCH —
identifiers, status codes, `createdon`, computed names — gets
`read_only = true`. Only genuinely editable columns stay writable.

**`description` is API documentation.** It is what a developer (or a model
scaffolding a UI) sees when discovering the route. "Case title" is useful;
"title" is not.

**`filters` defaults to `["statecode eq 0"]`** — active rows only. Override it
when a portal must show closed records too; the rcportal opportunity route does
exactly that.

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
