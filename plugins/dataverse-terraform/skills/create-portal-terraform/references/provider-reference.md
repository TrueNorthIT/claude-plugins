# `TrueNorthIT/dataversecontact` — provider reference

Complete surface of the Terraform provider, taken from the v1.0.2 schema. The
provider's own `examples/` directory is **stale** — it shows a `schema_json`
attribute on `dataversecontact_table` that no longer exists. Trust this file.

Registry: <https://registry.terraform.io/providers/TrueNorthIT/dataversecontact>

```hcl
terraform {
  required_providers {
    dataversecontact = {
      source  = "TrueNorthIT/dataversecontact"
      version = "~> 1.0"
    }
  }
}

provider "dataversecontact" {
  api_url        = var.api_url        # or DATAVERSE_CONTACT_API_URL
  connection_key = var.connection_key # or DATAVERSE_CONTACT_CONNECTION_KEY
}
```

| Provider argument | Notes |
|---|---|
| `api_url` | Base URL, e.g. `https://api.dataverse-contact.tnapps.co.uk`. Env: `DATAVERSE_CONTACT_API_URL`. |
| `connection_key` | Sensitive. Sent as `Authorization: Bearer <key>` on every admin call. Must be **byte-identical** to `ADMIN_CONNECTION_KEY` on the API deployment. Env: `DATAVERSE_CONTACT_CONNECTION_KEY`. |
| `api_key` | Deprecated alias for `connection_key`. Don't use in new configs. |

One key administers **every** scope on that deployment, so it is a
deployment-wide secret. It is a different credential from the one the
`contact-admin` CLI uses (workforce Entra + Dataverse security roles) — both
reach the same admin plane.

## `dataversecontact_table`

Publishes a Dataverse table as an API route. Saves a draft and publishes it in
a single apply.

### Attributes

| Attribute | Required | Notes |
|---|---|---|
| `scope` | yes | Forces replacement when changed. |
| `route_name` | yes | URL segment, e.g. `case`. Forces replacement. |
| `dataverse_table` | yes | OData **entity set** name, e.g. `incidents`. |
| `primary_key` | yes | e.g. `incidentid`. |
| `default_select` | yes | Columns returned when the caller doesn't pass `$select`. |
| `lookup_fields` | yes | Columns returned by the `/lookup` route. |
| `fields` | yes | Map keyed by Dataverse **logical name** — see below. |
| `dataverse_logical_name` | no | Derived by singularising `dataverse_table` when omitted. |
| `required_permission` | no | Defaults to `route_name`. |
| `description` | no | Shown in table listings. |
| `icon` | no | e.g. `incident.svg`. |
| `permission_group` | no | Share one permission with another route — see `patterns.md`. |
| `aliases` | no | Extra route names that resolve here. |
| `lookup_search_contains` | no | Lookup columns matched with `contains` instead of `startswith`. **Always set this explicitly** (`[]` if unused) — the provider reads it back as `[]`, never null, so omitting it causes perpetual drift. |
| `filters` | no | Always-on filter expressions. Server default `["statecode eq 0"]`. |
| `fetch_xml` | no | FetchXML template for custom list queries. |
| `public_choices` | no | Default `true`. Choice/option-set values readable unauthenticated. |
| `public_read` | no | Default `false`. Route readable on the public tier. |
| `public_create` | no | Default `false`. Unauthenticated POST allowed. |

Computed: `id` (`{scope}/{route_name}`), `source` (`published` / `built-in`),
`field_count`.

### `fields`

```hcl
fields = {
  incidentid  = { type = "string", description = "Case ID", read_only = true }
  title       = { type = "string", description = "Case title" }
  statuscode  = { type = "choice", description = "Status", read_only = true }
  customerid  = { type = "lookup", description = "Customer", lookup_table = "contact" }
}
```

| Key | Notes |
|---|---|
| `type` | One of `string`, `number`, `datetime`, `boolean`, `lookup`, `choice`. |
| `description` | Required — it is the API's field documentation, not a comment. |
| `read_only` | Excluded from PATCH. |
| `lookup_table` | For `lookup`: **route name** of the target table. |
| `value_field` | For polymorphic lookups: the underlying OData value column. |
| `bind_field` | For aliased fields: navigation property used for `@odata.bind` writes. |

### Blocks

```hcl
contact_join_step { table = "contacts", from = "contactid", key = "contactid" }
team_join_step    { table = "accounts", from = "parentcustomerid_account", key = "accountid" }

alternate_contact_join_path {
  step { table = "...", from = "...", key = "..." }
}

create_default {
  field      = "tn_Citizen"   # navigation property / lookup field
  bind_to    = "contact"      # "contact" or "account"
  entity_set = "contacts"     # entity set for the @odata.bind URL
}

parent_table {
  table               = "servicebooking"
  navigation_property = "tn_Booking"
}

expand {
  lookup_field  = "parentcustomerid_account"
  related_table = "account"
  field { name = "name", type = "string", description = "Account name" }
}
```

Join-step arguments: `table`, `from`, `key` (all required — pass `key = ""`
where there is none) and `reverse` (optional bool). Steps are **ordered**; each
hop walks from the previous table to the next.

## `dataversecontact_custom_api`

Registers a Dataverse Custom API as a callable route.

```hcl
resource "dataversecontact_custom_api" "expand_calendar" {
  scope       = var.scope
  route_name  = "expand-calendar"
  schema_json = file("${path.module}/schemas/ExpandCalendar.customapi.json")
}
```

`schema_json` is the CustomApiHint document:

```json
{
  "routeName": "expand-calendar",
  "dataverseUniqueName": "ExpandCalendar",
  "requiredPermission": "expand-calendar:invoke",
  "isFunction": true,
  "publicInvoke": true,
  "bindingType": "entity",
  "boundEntityLogicalName": "calendar",
  "boundEntitySetName": "calendars",
  "requestParameters": [
    { "uniqueName": "Start", "type": "datetime" },
    { "uniqueName": "End", "type": "datetime" }
  ]
}
```

Computed: `id`, `source`, `dataverse_unique_name`, `is_function`,
`binding_type`.

### The CustomApiHint schema in full

`schema_json` is hand-written, so this is the complete field set — there is no
HCL schema to validate it for you.

| Field | Required | Notes |
|---|---|---|
| `routeName` | yes | URL segment under `/public/actions/{routeName}` — see the routing note below. |
| `dataverseUniqueName` | yes | The Custom API's unique name in Dataverse — used in the OData URL. |
| `isFunction` | yes | `true` = GET, read-only. `false` = POST, has side effects. |
| `bindingType` | yes | `global` (service root), `entity` (bound to one record), `entityCollection` (bound to a set). |
| `boundEntityLogicalName` | for bound | Logical entity name, e.g. `calendar`. |
| `boundEntitySetName` | for `entity` | Entity set name, e.g. `calendars`. |
| `displayName` | no | Defaults to `dataverseUniqueName`. |
| `description` | no | Shown in discovery and the OpenAPI document. |
| `requiredPermission` | no | Defaults to `{routeName}:invoke`. |
| `publicInvoke` | no | Default `false`. Callable unauthenticated. Cannot be combined with `ownershipCheck`. |
| `requestParameters` | no | Inputs. Defaults to `[]`. |
| `responseProperties` | no | Outputs. Defaults to `[]`. |
| `ownershipCheck` | no | Tier-aware ownership verification — see below. |

Each parameter is `{ uniqueName, displayName, type, description?,
logicalEntityName?, isOptional? }`. Valid `type` values: `boolean`, `datetime`,
`decimal`, `entity`, `entityCollection`, `entityReference`, `float`, `integer`,
`money`, `picklist`, `string`, `stringArray`.

Custom APIs are **not row-scoped** the way tables are. If an action affects a
specific record, `ownershipCheck` is what stops a caller acting on someone
else's:

```json
"ownershipCheck": {
  "dataverseTable": "incidents",
  "primaryKey": "incidentid",
  "recordIdPath": "CaseRef",
  "contactColumn": "customerid_contact",
  "accountColumn": "customerid_account",
  "filters": ["statecode eq 0"]
}
```

It reuses the same join logic as table writes: the caller's invoke tier decides
whether ownership is checked against their contact (`me`), their account
(`team`), or just the filters (`all`). Omit `recordIdPath` for entity-bound
actions — the record ID comes from the URL. Omit `contactColumn` or
`accountColumn` to withhold that tier entirely.

A POST action that mutates a record, has no `ownershipCheck`, and is granted
`invoke` is worth flagging in review: nothing ties the call to the caller.

## `dataversecontact_permissions_sync`

Publishes the scope's `defaults.json` — the baseline permissions every
authenticated caller gets. Despite the name it syncs nothing to an identity
provider; the Auth0 code it was named for is gone.

**This resource is not optional.** A scope with no published `defaults.json`
grants nothing: every route answers `403 Missing required permission: <route>`,
reads included.

```hcl
resource "dataversecontact_permissions_sync" "scope" {
  scope               = var.scope
  allow_self_register = true

  company_model = {
    strategy = "parent-account"
  }

  join = {
    strategy      = "domain-list"
    domain_field  = "new_portaldomains"
    require_match = true
  }

  default_permissions = {
    contact = ["me", "write"]
    case    = ["me", "team", "write", "create"]
  }

  triggers   = { routes_hash = sha256(join(",", [dataversecontact_table.case.id])) }
  depends_on = [dataversecontact_table.case]
}
```

| Attribute | Notes |
|---|---|
| `scope` | Forces replacement when changed. |
| `default_permissions` | Map of route name → action list. Valid actions: `me`, `team`, `all`; `write`, `write:team`, `write:all`; `create`, `create:team`, `create:all`; `lookup`, `lookup:team`, `lookup:all`; `invoke`, `invoke:team`, `invoke:all`. An unrecognised action fails scope load, so a typo takes the whole scope down. |
| `allow_self_register` | Default `false`. Lets a signed-in caller with no contact self-provision via `POST /me/register`. |
| `company_model` | Nested **attribute** (`= { … }`, not a block). `strategy` is `parent-account` or `associated-accounts`; the latter takes `associated_accounts = { relationship, account_id_field, account_name_field, fetch_xml }`. |
| `join` | Nested **attribute**. `strategy` (only `domain-list` today), `domain_field`, `require_match`. |
| `triggers` | Map of strings — change any value to force a re-publish. |

Computed: `id` (the scope name), `permission_count`.

`company_model` and `join` are nested attributes, not blocks. Writing
`company_model { strategy = "…" }` is a syntax error.

## Data sources

Three, all read-only. Useful for wiring one config to another, or for asserting
what is live without leaving Terraform.

```hcl
# Every scope on the deployment
data "dataversecontact_scopes" "all" {}
# → .scopes : list(string)

# One route's published schema
data "dataversecontact_table" "case" {
  scope      = var.scope
  route_name = "case"
}
# → .schema_json, .source ("published" | "built-in" | "draft"),
#   .dataverse_table, .dataverse_logical_name, .required_permission,
#   .primary_key, .field_count

# Every route in a scope
data "dataversecontact_table_definitions" "all" {
  scope = var.scope
}
# → .definitions : list of { route_name, source, description, dataverse_table,
#   dataverse_logical_name, required_permission, primary_key, field_count }
```

`dataversecontact_table` (the data source) exposes `schema_json`, which the
*resource* no longer has — reading a route back gives you JSON, but writing one
is native HCL.

## What the config produces at runtime

### The scope is part of every URL

Scope is the **first path segment** after `/api/v2`, on both planes:

```
/api/v2/{scope}/{tier}/{route}          ← citizen-facing
/api/v2/_admin/{scope}/table-manager/…  ← admin (what this provider calls)
/api/v2/_admin/scopes                   ← the one global admin op
```

So `rcportal`'s case list is `/api/v2/rcportal/me/case`, and `citizenbooking`'s
is `/api/v2/citizenbooking/me/case` — same provider, same deployment, different
scope, entirely separate route tables and permissions. A scope is the unit of
isolation between portals.

(The API also accepts an older shape where the scope arrives as a `?scope=`
query parameter from a Vercel rewrite and the path carries no scope segment.
Both reach the same handlers. Write new links against the path form.)

Two consequences for Terraform:

- **`scope` forces replacement.** It carries `RequiresReplace` on all three
  resources. Changing `var.scope` on an existing config does not rename
  anything — it destroys every route in the old scope and creates them in the
  new one, and destroy here is a permanent delete. To move a portal between
  scopes, apply the new scope first and retire the old one deliberately.
- **One repo, one scope** is the convention across every portal in the stack:
  `var.scope` with a default, `SCOPE` in `.env`, and `run.sh` exporting it as
  `TF_VAR_scope`. Routes from two scopes in one config would work, but nothing
  in the repo layout expects it.

### Endpoints a published route gains

A published route becomes a set of endpoints under `/api/v2/{scope}/{tier}/…`,
where tier is one of `me`, `team`, `all` or `public`:

| Endpoint | Does |
|---|---|
| `GET /api/v2/{scope}/{tier}/{route}` | List, scoped by the tier's join path |
| `POST /api/v2/{scope}/{tier}/{route}` | Create (needs `create`; `create_default` bindings applied) |
| `GET|PATCH /api/v2/{scope}/{tier}/{route}/{id}` | Single record |
| `GET /api/v2/{scope}/{tier}/lookup/{route}` | Type-ahead over `lookup_fields` |
| `GET /api/v2/{scope}/{tier}/aggregate/{route}` | Aggregates |
| `GET /api/v2/{scope}/{tier}/changes/{route}` | Dataverse change-tracking delta |
| `GET /api/v2/{scope}/choices[/{route}[/{field}]]` | Option-set values — governed by `public_choices` |

The `public` tier is deliberately narrower: list, single record and
`/public/actions/{name}` only. It rejects `lookup` and `aggregate` outright, so
`public_read` never hands an anonymous caller a type-ahead over your data.

**Custom APIs are only invocable on the public tier.** Verified against the
deployed API on 2026-08-25:

| Request | Result |
|---|---|
| `GET /api/v2/{scope}/public/actions/expand-calendar` | reaches the handler (`400 Missing required parameter: Start`) |
| `GET /api/v2/{scope}/actions/expand-calendar` | `404` — no such route |
| `GET /api/v2/{scope}/me/actions/expand-calendar` | `404 Unknown table: actions` — falls through to table routing |

The permission model has `invoke`, `invoke:team` and `invoke:all`, and the
`CustomApiHint` type comment still describes `/api/v2/{scope}/actions/{name}`,
but the router only wires `actions` under `public`. So a custom API needs
`publicInvoke: true` to be callable at all today, and an `invoke` grant in
`default_permissions` has no route to authorise on the authenticated tiers.
Say so if a config contains one — it is dead configuration, not a working
permission.

Scope-level endpoints the `permissions_sync` settings govern:

| Endpoint | Governed by |
|---|---|
| `GET /api/v2/{scope}/me/whoami` | always available to an authenticated caller |
| `POST /api/v2/{scope}/me/register` | `allow_self_register` |
| `GET /api/v2/{scope}/me/companies` | `company_model` |
| `GET /api/v2/{scope}/me/claimable-companies` | `join` (domain matching) |

Also served per scope: `GET /api/v2/{scope}/schema`,
`GET /api/v2/{scope}/openapi.json`, and an MCP endpoint at
`/api/v2/{scope}/mcp` — all of which reflect whatever this Terraform published.

## Publish lifecycle

What an apply actually does, in order:

1. Each `dataversecontact_table` **saves a draft and publishes it** in one call.
   There is no separate publish step to remember, and no half-applied state.
2. Publishing writes `published/{scope}/{entity}/{route}.schema.json` to blob
   storage; `permissions_sync` writes `published/{scope}/defaults.json`.
3. The API invalidates its registry cache on publish. That cache otherwise has
   a **5-minute TTL**, so on a multi-instance deployment other instances can
   serve the previous definition for up to five minutes.
4. `terraform destroy` is **permanent for the route definition**. Deleting a
   `dataversecontact_table` unpublishes it, moves it to the recycle bin, *and*
   permanently deletes it — three calls, no safety net left behind. The
   Dataverse table and its rows are untouched; the published schema is gone and
   has to be re-applied to come back. Say this plainly before anyone destroys a
   scope they care about.

Nothing in this provider reads, writes or deletes citizen data. It manages
configuration only.

## Import

`dataversecontact_table` and `dataversecontact_custom_api` import with
`{scope}/{route_name}`:

```bash
terraform import 'dataversecontact_table.case' 'myscope/case'
```

`dataversecontact_permissions_sync` **cannot be imported** — it is a publish
action, not a queryable object. It always shows as "1 to add" on the first plan
after adopting an existing scope; the apply re-publishes the same defaults.

## Admin endpoints behind the provider

Useful for reading a scope's current state without Terraform. All take
`Authorization: Bearer <connection_key>`.

| Endpoint | Returns |
|---|---|
| `GET /api/v2/_admin/scopes` | Every scope on the deployment. |
| `GET /api/v2/_admin/{scope}/table-definitions` | Every route's **full** schema — enough to generate HCL for the whole scope in one call. |
| `GET /api/v2/_admin/{scope}/table-manager/{route}` | One route's stored schema plus any draft. |
| `GET /api/v2/_admin/{scope}/custom-api-definitions` | Custom API routes, **resolved** (adds derived `apiType`, explicit nulls). |
| `GET /api/v2/_admin/{scope}/custom-api-manager/{route}` | The published bytes — use this one when writing `schema_json` files. |
| `GET /api/v2/_admin/{scope}/table-manager/defaults` | `{ defaults, effective }`. `defaults` is the blob overlay Terraform owns; `effective` merges in any filesystem baseline. |
| `PUT /api/v2/_admin/{scope}/table-manager/defaults` | What `permissions_sync` writes. |

## JSON ↔ HCL mapping

The API speaks camelCase JSON; the provider speaks snake_case HCL. When
translating a published schema by hand:

| JSON | HCL |
|---|---|
| `routeName` | `route_name` |
| `dataverseTable` / `dataverseLogicalName` | `dataverse_table` / `dataverse_logical_name` |
| `primaryKey` | `primary_key` |
| `requiredPermission` | `required_permission` |
| `permissionGroup` | `permission_group` |
| `defaultSelect` | `default_select` |
| `lookupFields` / `lookupSearchContains` | `lookup_fields` / `lookup_search_contains` |
| `fetchXml` | `fetch_xml` |
| `publicChoices` / `publicRead` / `publicCreate` | `public_choices` / `public_read` / `public_create` |
| `contactJoinPath[]` | repeated `contact_join_step` blocks |
| `teamJoinPath[]` | repeated `team_join_step` blocks |
| `alternateContactJoinPaths[][]` | repeated `alternate_contact_join_path { step … }` |
| `createDefaults[]` (`field`, `bindTo`, `entitySet`) | `create_default` (`field`, `bind_to`, `entity_set`) |
| `parentTable` (`table`, `navigationProperty`) | `parent_table` (`table`, `navigation_property`) |
| `expands[]` (`lookupField`, `relatedTable`, `fields[]`) | `expand` (`lookup_field`, `related_table`, `field` blocks) |
| `fields{}` (`readOnly`, `lookupTable`, `valueField`, `bindField`) | `fields` map (`read_only`, `lookup_table`, `value_field`, `bind_field`) |
| defaults: `permissions`, `allowSelfRegister`, `companyModel`, `join` | `default_permissions`, `allow_self_register`, `company_model`, `join` |

`scripts/export-scope.mjs` does this translation for a whole scope.
