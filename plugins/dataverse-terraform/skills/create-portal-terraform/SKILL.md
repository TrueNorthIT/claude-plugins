---
name: create-portal-terraform
description: Define, and explain, a Dataverse Contact API portal backend as Terraform — which tables are published as routes, which fields callers can read and write, how rows are scoped to the signed-in citizen, and the baseline permissions. Use when the user asks to create / write / generate Terraform for the portal API or for a scope, to codify or export an existing scope as Terraform, to import a scope into Terraform state, to provision a new scope with terraform apply, or to add a table / route / permission to an existing Contact API Terraform repo. Also use to explain, review, document or hand over an existing Contact API Terraform config — "what does this scope expose", "who can see X", "what will this apply do", or reviewing a change for whether it widens access. Works against the public TrueNorthIT/dataversecontact provider.
---

# create-portal-terraform

A Contact API **scope** is a portal's whole backend: the Dataverse tables it
publishes as routes, the fields each route exposes, how every row is scoped back
to the signed-in citizen, and what an authenticated caller may do. This skill
puts all of that in Terraform, so a portal backend can be reviewed in a pull
request, reproduced in a new environment in minutes, and torn down cleanly. It
also reads a config back in plain English, because "who can see whose records"
is the question the HCL exists to answer and the one it answers least legibly.

The provider is public: `TrueNorthIT/dataversecontact` on registry.terraform.io.

## Three modes

Work out which one applies before doing anything else:

| The user wants… | Mode | Start at |
|---|---|---|
| an existing scope (built by hand, Table Manager, or an earlier apply) in Terraform | **adopt** | step A1 |
| a scope that does not exist yet | **build** | step B1 |
| to understand a config that already exists — review it, hand it over, or check who can see what | **explain** | step C1 |

If the user hasn't said, list the scopes and ask — it takes one call:

```bash
curl -s -H "Authorization: Bearer $DATAVERSE_CONTACT_CONNECTION_KEY" \
  "$DATAVERSE_CONTACT_API_URL/api/v2/_admin/scopes"
```

Adopt is almost always the right answer for an existing portal, and it is the
one that pays off immediately — it is a single command and the result is
verifiable.

## Reference files

Load on demand, not upfront:

| When you are doing this | Read |
|---|---|
| Writing or editing any resource | `references/provider-reference.md` |
| Deciding how a route should be scoped or permissioned | `references/patterns.md` |
| Explaining, reviewing or handing over a config | `references/explaining.md` |

The provider's own `examples/` directory is stale — it shows a `schema_json`
attribute on `dataversecontact_table` that no longer exists. Use the reference
file instead.

Paths like `scripts/export-scope.mjs` below are relative to **this skill's own
directory**, not the user's project — invoke them with the skill's absolute path.

## Prerequisites

They differ by mode. **Explaining a config needs nothing at all** — no
credentials, no network, not even Terraform installed:

| Doing this | Needs |
|---|---|
| Explaining, reviewing or documenting a config (mode C) | Nothing. It is a read of the `.tf` files in front of you |
| Scaffolding a new scope (`--new`, step B1) | Nothing |
| Writing or editing resources by hand | Nothing to write; credentials only to apply |
| Exporting a live scope (step A1) | The connection key and API URL |
| `plan`, `apply`, `import`, `destroy` | Terraform ≥ 1.0 on PATH, plus both of the below |

- **The admin connection key.** Byte-identical to `ADMIN_CONNECTION_KEY` on the
  API deployment, exported as `DATAVERSE_CONTACT_CONNECTION_KEY`. One key
  administers every scope on that deployment, so treat it as a deployment-wide
  secret: it belongs in `.env` (gitignored), never in a `.tf` file.
- **API base URL** as `DATAVERSE_CONTACT_API_URL`, e.g.
  `https://api.dataverse-contact.tnapps.co.uk`.

When a step that genuinely needs the key can't find one, stop and ask for it.
Do not invent one, and do not fall back to the `contact-admin` CLI's Entra
login — that is a different credential and the provider cannot use it.

**Never ask for a key to answer a question the files already answer.** "What
does this scope expose", "who can see quotes", "does this PR widen access" are
all answerable from the config alone. Asking for production credentials to read
a repo is both unnecessary and a bad habit to model.

---

## Mode A — adopt an existing scope

### A1. Export it

```bash
node scripts/export-scope.mjs --scope <scope> --out <dir>
```

Reads the scope's published tables, custom APIs and `defaults.json` through the
admin API and writes a complete repo: `main.tf`, `variables.tf`, `outputs.tf`,
`run.sh`, `import.sh`, `.env.example`, `.gitignore`, `README.md`, and a
`schemas/` directory for any custom APIs. Read-only — it publishes nothing.

It skips built-in routes and says so. Those come from the API's own filesystem
config, not from blob storage, so Terraform has no business owning them.

### A2. Adopt the live state

```bash
cd <dir>
cp .env.example .env        # add the connection key
bash import.sh
bash run.sh plan
```

### A3. Read the plan carefully

A correct adoption looks like this:

```
Plan: 1 to add, 0 to change, 0 to destroy.
```

The one addition is `dataversecontact_permissions_sync` — it cannot be
imported, because publishing defaults is an action rather than a queryable
object. Applying it re-publishes the `defaults.json` the export just read back,
so the write is identical to what is already live.

Anything else in the plan is a real finding — report it rather than applying
over it:

| In the plan | What it means |
|---|---|
| a table **to add** | the route is built-in, or was published after the export |
| a table **to change** | the generated HCL doesn't match live config — investigate before applying |
| a custom API `~ schema_json … # whitespace changes` | benign: state holds the API's compact JSON, the file is pretty-printed. One apply re-publishes identical content and settles it permanently |
| anything **to destroy** | stop. An export never justifies a destroy |

Only apply once the plan is understood. `bash run.sh apply` publishes for real.

---

## Mode B — build a new scope

### B1. Scaffold

```bash
node scripts/export-scope.mjs --scope <scope> --new --out <dir>
```

Writes the same repo shape around a starter `main.tf` containing a working
`contact` route and a `permissions_sync` block. No API call, no key needed.

### B2. Discover the schema — never write a field name from memory

Column names, types, join paths and create-defaults all come off the live
deployment. A guessed field name produces HCL that plans cleanly and then 400s;
a guessed join path produces something worse — a `200` with an empty list,
which looks like missing data rather than a wrong config.

Take the first of these that applies.

**1. The API already serves this table as a built-in route.** The best case, and
it covers `contact`, `case`, `account` and the rest of the default scope. One
GET returns the whole shape, and it needs **no credentials at all**:

```bash
curl -s "$DATAVERSE_CONTACT_API_URL/api/v2/default/schema?table=case"
```

You get `primaryKey`, `dataverseLogicalName`, `filters`, `defaultFields`,
`createDefaults`, and `fields[]` with each column's `type`, `readOnly` and
`isDefault` — plus the part that earns the call on its own:

| In the response | Maps to |
|---|---|
| `contactScope.joinPath` | `contact_join_step` |
| `contactScope.alternateJoinPaths` | `alternate_contact_join_path` |
| `teamScope.joinPath` | `team_join_step` |
| `createDefaults[]` | one `create_default` block each |

Those are the security boundary. Copy them; do not re-derive them, and do not
reason about which lookup "should" be the right one when the deployment will
tell you.

**2. The table is published on some scope already.** Same document, any scope:

```bash
curl -s "$DATAVERSE_CONTACT_API_URL/api/v2/<scope>/schema?table=<route>"
```

**3. Neither — the API has never served this table.** Only now fall back to
Dataverse metadata. This one needs the `contact-admin` CLI and a **workforce
Entra login**, which is a different credential from the Terraform connection
key, so it is not available to everyone who can otherwise do this work:

```bash
npm install -g @truenorth-it/contact-admin
contact-admin discover entity <logicalName> --url "$API_URL" --scope "$SCOPE" --json
contact-admin discover children <parentLogicalName> --url "$API_URL" --scope "$SCOPE" --json
```

Say which of the three you used. "I read it off the deployment" and "I recalled
it" are very different claims about a join path, and only one of them is
checkable.

> **A built-in's field list is not a template to copy wholesale.** Built-in
> routes are served from the API's own filesystem config, which may declare
> things the provider path cannot. `case` lists the polymorphic navigation
> properties `customerid` and `ownerid`; put either in `fields` and the apply
> fails with a state-consistency error about a dropped field. Its `defaultFields`
> is tuned for its own UI too, and omits `description`. Take the join paths and
> the create-defaults verbatim — filter the field list.

### B3. Write one resource per route

Follow `references/provider-reference.md` for the attribute surface and
`references/patterns.md` for the modelling decisions. For each route decide, in
this order:

1. **What the route is** — `dataverse_table` (entity set), `primary_key`,
   `route_name`.
2. **How a row belongs to a person** — `contact_join_step`, and
   `team_join_step` if colleagues should see it. This is the security boundary;
   get it right before anything else. An ownerless child gets a reverse join
   through its parent, never `["all"]`.
3. **What callers may see** — `fields` (with `read_only` on everything a
   citizen must not PATCH) and `default_select`.
4. **What callers may do** — the route's entry in `default_permissions`.

### B4. Plan, apply, verify

```bash
cd <dir>
cp .env.example .env        # add the connection key
bash run.sh plan
bash run.sh apply
```

Then prove the routes actually answer, rather than trusting the apply:

```bash
curl -s -H "Authorization: Bearer $DATAVERSE_CONTACT_CONNECTION_KEY" \
  "$DATAVERSE_CONTACT_API_URL/api/v2/_admin/<scope>/table-definitions" | head -c 400
```

---

## Mode C — explain a config

Use this when the user asks what a config does, wants a review before applying,
is handing the repo to someone else, or asks a narrower question like "who can
see quotes?" or "what would this apply actually change?".

### C1. Read the source of truth

Read the `.tf` files themselves — not the API, and not this skill's examples.
The config is what a reviewer is being asked to approve, and it may differ from
what is live.

This needs no credentials and no network. A freshly cloned repo, a PR diff, or
a config for a deployment you have no access to can all be explained in full,
because everything that decides who sees what is in the HCL.

The one exception is *"does this match what's actually deployed?"*, which is a
different question. Answering it needs the key: run `bash run.sh plan` and read
the diff, rather than comparing two things by eye. Say which question you are
answering — a config review is not a drift check.

### C2. Work through `references/explaining.md`

It carries the route-by-route method, the plain-English rendering of join
paths, the permission vocabulary, and the list of constructs to flag every time
(`all`, `public_read`, `public_create`, `filters = []`, `create_default`,
self-registration settings).

### C3. Answer at the altitude asked

- **"Explain this config"** → the full write-up: purpose, route table, security
  boundary, flagged lines, what an apply would do.
- **"Who can see X?"** → that route's permission entry, its join path in one
  sentence, and whether anything widens it. Don't dump the whole scope.
- **"What will this apply do?"** → run `plan` and read it back in English.
  Nothing here touches citizen data; it republishes route definitions and the
  scope's `defaults.json`.
- **"Review this PR"** → what changed, and specifically whether it widens who
  can see what. A schema tweak is routine; a permission or `public_*` change is
  the thing to stop on.

Quote the `main.tf` lines you are describing. An explanation that can't be
traced to a line is a guess, and on access control a plausible guess is worse
than saying you're unsure.

---

## Editing an existing Terraform repo

Adding a route to a repo that already exists is the common follow-up. Discover
the new table's schema first (step B2) — the surrounding config being correct is
no evidence at all about a table it has never described. Then three things must
stay in step, and forgetting the third is the usual bug:

1. the new `dataversecontact_table` resource,
2. its entry in `default_permissions` (unless it uses `permission_group` or is
   `public_read`),
3. the new resource's `id` in both `triggers` and `depends_on` on
   `permissions_sync` — otherwise the defaults are not re-published and the
   route answers 403 despite a clean apply.

Run `terraform fmt` before finishing.

## Failure modes worth recognising

| Symptom | Cause |
|---|---|
| `403 Missing required permission: <route>` on every call, reads included | no published `defaults.json` — `permissions_sync` is missing or was never applied |
| provider state-consistency error mentioning a dropped field | a polymorphic navigation property (`customerid`, `parentcustomerid_account`) was declared in `fields`. Use it in joins and `expand` only |
| `401`/`403` from the provider itself | `connection_key` isn't byte-identical to `ADMIN_CONNECTION_KEY` on the deployment |
| a one-line `lookup_search_contains = [] -> null` diff that never goes away | the attribute is omitted from config; set it explicitly, `[]` if unused |
| `company_model { … }` fails to parse | it is a nested attribute, not a block: `company_model = { … }` |
