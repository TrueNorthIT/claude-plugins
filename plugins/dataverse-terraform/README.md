# dataverse-terraform

Put a [Dataverse Contact API](https://api.dataverse-contact.tnapps.co.uk) portal
backend in Terraform — and read one back in plain English.

A Contact API **scope** is a portal's whole backend: the Dataverse tables it
publishes as routes, the fields each route exposes, how every row is scoped back
to the signed-in citizen, and what an authenticated caller may do. This plugin
manages all of that through the public
[`TrueNorthIT/dataversecontact`](https://registry.terraform.io/providers/TrueNorthIT/dataversecontact)
provider, so a portal backend can be reviewed in a pull request, reproduced in a
new environment in minutes, and torn down cleanly.

## Install

```bash
claude plugin marketplace add TrueNorthIT/claude-plugins   # once
claude plugin install dataverse-terraform@truenorthit
```

Or in a session: `/plugin marketplace add TrueNorthIT/claude-plugins` then
`/plugin install dataverse-terraform@truenorthit`.

The plugin checks for updates at session start and tells you when to run
`/plugin marketplace update truenorthit`.

## What you can ask for

The skill is auto-invoked — you don't call it by name. It triggers on requests
like:

| Say | Get |
|---|---|
| "export the `rcportal` scope to Terraform" | A complete repo, imported, planning clean |
| "create Terraform for a new `bookings` scope" | Scaffolded repo with a working `contact` route |
| "explain what this Terraform exposes" | Route-by-route account of who can see what |
| "who can see quotes in this config?" | That route's permission, its join path, anything widening it |
| "does this PR widen access?" | A review focused on the permission surface |
| "add a `casenotes` route to this repo" | The resource, its permission entry, and the `triggers`/`depends_on` wiring |

## What you need

Only some of it, only some of the time:

| Doing this | Needs |
|---|---|
| Explaining, reviewing or documenting a config | **Nothing** — no key, no network, not even Terraform |
| Scaffolding a new scope | Nothing |
| Exporting a live scope | `DATAVERSE_CONTACT_CONNECTION_KEY` + `DATAVERSE_CONTACT_API_URL` |
| `plan` / `apply` / `import` / `destroy` | Terraform ≥ 1.0, plus both of the above |

The connection key is the API deployment's `ADMIN_CONNECTION_KEY`. One key
administers every scope on that deployment, so treat it as a deployment-wide
secret — it belongs in `.env` (gitignored), never in a `.tf` file. It is a
different credential from the one `contact-admin` uses (workforce Entra).

## Adopting a scope that already exists

The common case, and the one that pays off immediately:

```bash
node scripts/export-scope.mjs --scope rcportal --out ./rcportal-terraform
cd rcportal-terraform
cp .env.example .env        # add the connection key
bash import.sh              # adopt the live routes into state
bash run.sh plan            # expect: 1 to add, 0 to change
```

The export is read-only — it publishes nothing. You get:

```
main.tf          every route, the custom APIs, and the permissions
variables.tf     api_url, connection_key, scope
outputs.tf       published tables, permission count
run.sh           loads .env and runs terraform
import.sh        adopts the live routes into state
.env.example     the two credentials, with the scope
.gitignore       .env and state
schemas/         *.customapi.json for any custom APIs
```

That "1 to add" is `dataversecontact_permissions_sync`, which cannot be
imported — publishing defaults is an action, not a queryable object. Applying it
re-publishes the `defaults.json` the export just read back.

Every route arrives already explaining itself:

```hcl
# ── casenotes ───────────────────────────────────────────────────────────
# Notes and updates on your support cases
# Dataverse: annotations
# me:   incidents via objectid_incident → contacts via primarycontactid
# team: incidents via objectid_incident → accounts via customerid_account
# No baseline grant — inherits the "case" permission group.
```

## Building a new scope

```bash
node scripts/export-scope.mjs --scope bookings --new --out ./bookings-terraform
```

No API call, no key. You get the same repo shape around a working `contact`
route and a `permissions_sync` block. Add a resource per table from there —
discover the real columns with:

```bash
contact-admin discover entity <logicalName> --url "$API_URL" --scope "$SCOPE" --json
```

## Things worth knowing before you apply

- **Nothing here touches citizen data.** The provider manages configuration:
  route definitions and a `defaults.json` blob. It never reads, writes or
  deletes a Dataverse row.
- **`terraform destroy` is permanent for a route definition.** It unpublishes,
  recycles *and* permanently deletes — no restore point. The Dataverse table and
  its rows survive; the published schema only comes back via re-apply.
- **`permissions_sync` is not optional.** A scope with no published
  `defaults.json` grants nothing: every route answers `403`, reads included.
- **`scope` forces replacement.** Changing `var.scope` on an existing config
  destroys every route in the old scope and creates them in the new one.
- **A change goes live when the registry cache turns over** — invalidated on
  publish, otherwise a 5-minute TTL per instance.

## Adding a route to an existing repo

Three things must stay in step; forgetting the third is the usual bug:

1. the new `dataversecontact_table` resource,
2. its entry in `default_permissions` (unless it uses `permission_group` or is
   `public_read`),
3. the resource's `id` in **both** `triggers` and `depends_on` on
   `permissions_sync` — otherwise the defaults are never re-published and the
   route answers 403 despite a clean apply.

## Layout

```
dataverse-terraform/
├── hooks/                            update check at session start
└── skills/create-portal-terraform/
    ├── SKILL.md                      the workflow — adopt, build, explain
    ├── references/
    │   ├── provider-reference.md     every resource, data source and attribute
    │   ├── patterns.md               row scoping, reverse joins, permissions
    │   └── explaining.md             how to read a config back to a human
    └── scripts/export-scope.mjs      live scope → Terraform repo
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `403 Missing required permission` on every call | No published `defaults.json` — `permissions_sync` missing or never applied |
| Provider state-consistency error about a dropped field | A polymorphic navigation property (`customerid`, `parentcustomerid_account`) was declared in `fields`. Use it in joins and `expand` only |
| `401`/`403` from the provider itself | `connection_key` isn't byte-identical to `ADMIN_CONNECTION_KEY` |
| A `lookup_search_contains = [] -> null` diff that never clears | The attribute is omitted; set it explicitly, `[]` if unused |
| `company_model { … }` won't parse | It's a nested attribute, not a block: `company_model = { … }` |
| A custom API shows a `# whitespace changes` diff | Benign. State holds the API's compact JSON, the file is pretty-printed; one apply settles it |
