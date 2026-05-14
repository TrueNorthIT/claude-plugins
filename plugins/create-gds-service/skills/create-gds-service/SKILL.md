---
name: create-gds-service
description: Scaffolding or removing a GOV.UK Design System (GDS) service in service-builder-flow. Use when the user wants to create / add / build / scaffold a new service, set up a service folder under public/services, draft service pages, or register a service in Dataverse. Also use when the user wants to delete / remove / retire / decommission / take down an existing service. Generates a service.json, GDS-clean markdown pages with gds-form YAML, and a Dataverse row CLI script for create — produces a safety-gated delete CLI for removal.
---

# Create a GDS service

This skill stands up a new GDS-compliant service in this repo (service-builder-flow). One service spans three artefacts that must stay in step:

1. A folder under `public/services/<slug>/` with a `service.json` manifest and numbered markdown pages.
2. GDS-compliant content on every public-facing string (titles, labels, hints, buttons, confirmation copy).
3. A row in the `lcc_servicedefinition` Dataverse table that the spec generator picks up to publish an OpenAPI `operationId`.

Work through the steps below in order. Do not skip ahead; the later steps depend on decisions made in earlier ones.

## Reference files

Load these on demand — do not preload all of them:

| When you are doing this | Read this |
| --- | --- |
| Writing any user-facing text | `references/gds-rules.md` |
| Choosing a form component | `references/component-cheatsheet.md` |
| Writing `service.json` | `references/service-json-schema.md` |
| Deriving the Dataverse schema (step 6) | `references/dataverse-schema-mapping.md` |

Templates to copy from rather than write from scratch:

| For | Use |
| --- | --- |
| service.json | `templates/service.json` |
| A single-question page | `templates/page-single-question.md` |
| An address / composite page | `templates/page-composite.md` |
| The final confirmation page | `templates/page-confirmation.md` |
| Dataverse row payload | `templates/dataverse-row.json` |
| Dataverse CREATE CLI script | `templates/create-service-definition.ts` |
| Dataverse DELETE CLI script | `templates/delete-service-definition.ts` |

## Workflow

### 0. Decide the service shape

Before anything else, decide whether this is a **Dataverse-backed** service or a **form-only** service. The whole workflow branches on the answer.

| Question | Dataverse-backed | Form-only |
| --- | --- | --- |
| Does it post to a real backend (Liquidlogic, D365, etc.)? | Yes | No |
| Will it need an `operationId` in `openapi-spec.yaml`? | Yes | No |
| Does the user need a record in `lcc_servicedefinition`? | Yes | No |

Defaults if unstated:
- The user says "report …", "request …", "apply for …" → almost always Dataverse-backed.
- The user says "info-only", "just the forms", "demo service", or names a service the council doesn't actually transact (a "Find your nearest …" page) → form-only.
- If unsure, ask once: "Should this post to Dataverse, or is it form-only for now?"

**Form-only path:** do steps 1, 2, 3, 5, 7, 8. **Skip** steps 4 (OpenAPI mapping), 6 (Dataverse), 9 (spec verify). Every gds-form field must declare an inline `type` so the merger's form-first path works (see `scripts/audit/perService.ts` `formFirst` check). Omit `operationId` from `service.json` or set it to `null`.

**Dataverse-backed path:** do all steps in order.

### 1. Gather inputs

Ask the user for, or infer from the request:

- **Title** — sentence case, plain English. Example: "Report a flytipping incident".
- **Pattern** — exactly one of: `Apply`, `Book`, `Tell`, `Pay`, `Register`, `Request`, `Manage`, `Check`, `Enquire`, `Find`. Use the table in `references/service-json-schema.md` to decide.
- **Primary domain** — exactly one of the 16 LCC domain keys (see `service-json-schema.md`).
- **Short description** — one sentence, 25 words or fewer, sentence case, no full stop on the last word if it goes in a button.
- **The questions to ask the user** — a list. One question per page is the default.
- **OpenAPI `operationId`** — the form derived from the slug: `Create-<slug>-ServiceRequest-V1`. If the service is brand new, the spec generator will create this once the Dataverse row is in place (see step 6).

Derive the **slug** from the title: lower case, ASCII letters and digits only, words joined by single hyphens, no leading or trailing hyphens. Examples: `report-a-flytipping-incident`, `request-a-new-bin`. The slug is the folder name, the `id` field in `service.json`, and the `lcc_servicetype` value in Dataverse — these three must match exactly.

### 2. Apply GDS rules to every string

Before writing any user-facing copy, open `references/gds-rules.md` and treat it as a hard constraint. The high-impact rules, repeated here so they are not missed:

- **Sentence case everywhere**, including page titles and the service name. Not Title Case.
- **No em dashes (—), en dashes (–), exclamation marks, or semicolons.** Split into shorter sentences.
- **Positive contractions only**: "you're", "we'll". Spell out negatives: "cannot", "do not", "will not".
- **Word substitutions** (always replace):
  - submit / submission → send / sending
  - complete (a form) → fill in
  - contact (verb) → speak to, get in touch
  - in order to → to
  - prior to → before
  - regarding → about
  - utilise → use
  - please / please note → remove the word; instructions stand on their own
  - provide → give
  - purchase → buy
  - approximately → about
- **Buttons**: the "next page" button is always `Continue` (not "Next", not "Save and continue"). The final send button is `Accept and send`.
- **Check-answers heading**: exactly `Check your answers`. Do not append "before submitting".
- **Hints**: a single short sentence. No full stop. No links inside hint text.
- **Optional fields**: mark with `(optional)` in the label. Never use asterisks for required.

If any draft text violates one of these, fix it before moving on. This applies to page titles, field labels, hints, error messages, the service `title` and `description`, the confirmation `summary` and `whatHappensNext`, and anything that ends up rendered to the public.

### 3. Scaffold the folder

Create `public/services/<slug>/` with these files:

- `service.json` — start from `templates/service.json`. Fill in `operationId`, `id` (= slug), `title`, `description`, `pages`, `domainPrimary`, `pattern`, and set `status: "Draft"`. Only add the optional blocks (`submission`, `confirmation`, `notifications`, `accessibility`) if the user has answers for them.
- `01-<topic>.md`, `02-<topic>.md`, … — one numbered page per question. Use sentence-case slugs in the filename (`01-where.md`, `02-bin.md`, `03-reason.md`). Pick the right template:
  - Most pages → `templates/page-single-question.md`
  - Address, file upload, payment, repeater, email verify, time picker → `templates/page-composite.md`
  - The final confirmation screen → `templates/page-confirmation.md`

Check-answers is rendered automatically by the platform — do not add a `99-check.md`.

Reference services that are good to mimic:

- `public/services/request-new-bin/` — small, clean, includes a composite address-block page.
- `public/services/report-a-lost-stolen-or-misused-badge/` — five pages, demonstrates radios, textarea, optional fields, "About you" final page.

### 4. Map fields against the OpenAPI schema

In each `gds-form` block, `fields:` keys must be dot-paths that exist in the global OpenAPI spec (`openapi-spec.yaml`) under the service's `operationId`. The merger (`src/merger/mergeModel.ts`) resolves types, components, and validation from the spec. Use the markdown override only for content (`label`, `hint`, `show_when`, occasionally `component` when overriding auto-resolution).

If you do not know the exact field paths yet, write the page with placeholder paths and flag them at the bottom of the file as `<!-- TODO: confirm field path against openapi-spec.yaml -->`. Do not invent fields.

Component auto-resolution rules (full table in `references/component-cheatsheet.md`):

- `enum` with 4 or fewer values → `radios`
- `enum` with 5 or more values → `select`
- `boolean` required → `radios` (real Yes/No question)
- `boolean` optional → `checkbox` (tick if true)
- `date` → `date-input`
- everything else → `text-input`

Override `component:` only when this default is wrong — for example, forcing `textarea` for a long-form `string`, or forcing `checkbox` for a declaration ("I confirm the information is true").

### 5. Conditions (`show_when`)

If a question depends on a previous answer, use `show_when` on the field, section, or page. Use plain operators that match the Monaco authoring rules:

- `show_when: reason is "Damaged"` (string equality)
- `show_when: anonymous is not "Yes"`
- `show_when: bin_type is present` (any value entered)

Do not use raw `=`, `!=`, `&&`, `||` — the parser supports them but the authoring style for this repo is plain English.

### 6. Draft the Dataverse row

(Form-only services: skip this step.)

Copy `templates/dataverse-row.json` into the new service folder as `dataverse-row.json`. Fill in:

- `lcc_servicedisplayname` — the service title (sentence case, same string as `service.json` `title`).
- `lcc_servicedescription` — the same string as `service.json` `description`.
- `lcc_servicetype` — the slug.
- `lcc_version` — `"1.0.0"` for a new service.
- `lcc_requirecontactdetails` — `false` unless the user has said the service needs to collect a verified email up front.
- `lcc_servicemanagementtype` — keep the magic number `851800000`. Existing services all use it.
- `lcc_servicedataschema` — **derive this from the gds-form `fields:` blocks the skill just wrote**, not from imagination.

#### Deriving `lcc_servicedataschema` from the markdown

For every `fields:` entry across every page, emit one row in the array:

| Markdown field | DV row property | Rule |
| --- | --- | --- |
| The field key (last segment of any dot-path) | `name` | `applicant.email` → `email`. Use the bare key. |
| The field's `label` from the markdown | `description` | Strip trailing `(optional)`. Plain sentence; no question mark. |
| Inferred from the OpenAPI type or markdown override | `type` | See type-mapping table below. |
| `true` if `required: true` and label does not end with `(optional)`, else `false` | `required` | |
| Enum values when `type: Choice` | `values` | Mirror the option `value` strings exactly. |
| `1` for composite types (`address`, `file`) | `blockVersion` | |
| `"key-value"` for repeaters / metadata | `listType` | |

**Type mapping** (also documented in `references/dataverse-schema-mapping.md`):

| Markdown / OpenAPI | DV `type` |
| --- | --- |
| `string` (default) | `String` |
| `string` with `enum` | `Choice` (use `values`) |
| `boolean` | `Boolean` |
| `string` with `format: date` | `Date` |
| `number`, `integer` | `Number` |
| `component: address-block` | `address` (+ `blockVersion: 1`) |
| `component: file-upload` | `file` (+ `blockVersion: 1`) |
| `component: payment` | (do not emit — Stripe is its own flow) |
| `component: repeater` | `list` (+ `listType: "key-value"`, `blockVersion: 1`) |

Always append a final `metadata` row exactly as in `templates/dataverse-row.json` — this is how the back-end carries custom key-value pairs.

**Do not invent fields the markdown does not contain.** If a form has 4 questions, the schema has 4 rows + the trailing metadata. If a question has no obvious DV type, default to `String` and flag it inline.

The canonical worked example is `scripts/d365/ensure-request-new-bin.ts` lines 21–63 — keep it open in a second buffer while you derive.

**Do not stringify `lcc_servicedataschema` in the JSON file** — the CLI script handles that at POST time.

Then copy `templates/create-service-definition.ts` into `scripts/d365/create-<slug>.ts`. Edit the `SLUG` constant at the top and the import path of `dataverse-row.json`. Leave the rest alone.

**Do not run the script yet.** It needs `D365_*` env vars in `.env.local` and writes to a live system. Tell the user:

```
Dry-run first:
  npx tsx scripts/d365/create-<slug>.ts

Then, after reviewing the proposed payload:
  npx tsx scripts/d365/create-<slug>.ts --commit
```

### 7. Validate the service.json and markdown

Run the repo's audit script for the new slug:

```bash
npm run audit:services -- <slug>
```

Fix every warning before moving on. Common ones:

- `id must be lowercase kebab-case` — your `id` field has uppercase or underscores. Fix to match the slug.
- `lastReviewed must be ISO date YYYY-MM-DD` — drop the field or supply today in ISO form.
- Page in `pages` array does not exist on disk — filename mismatch with the actual `.md` file.

Then start the dev server and walk the journey in a browser to confirm pages render and questions flow:

```bash
npm run dev
```

Navigate to `/en/services/<slug>` (or whatever the default language path is for this repo) and click through every page. Spot-check:

- Page title is sentence case and matches the single question on that page.
- The button on each page reads `Continue`.
- Hint text is one sentence with no full stop.
- The check-answers page heading reads exactly `Check your answers`.
- The final button reads `Accept and send`.

If the dev server is not available in this environment (no GUI, no browser), say so explicitly to the user — do not claim the journey works without seeing it.

### 8. Save (commit) on the current draft

This repo treats commits as content saves. Match the editor glossary in `CLAUDE.md`:

- Branch is "draft", not "branch".
- Commit is "save", not "commit", in any message you say to the user.
- Push is "save" or "publish", depending on whether it goes to `preview` or `main`.

Stage only the new service files plus the optional CLI script you created:

```bash
git add public/services/<slug>/ scripts/d365/create-<slug>.ts
git commit -m "Add '<service title>' draft"
git push -u origin <current-branch>
```

Do not push to `develop`, `preview`, or `main` directly. The user opens a PR from their draft branch when they are ready, following the **Draft → Preview → Live** flow documented in `docs/cms.md`.

### 9. Verify the operationId in `openapi-spec.yaml`

(Form-only services: skip this step.)

Only after the user has run `--commit` on the Dataverse CLI:

```bash
# Confirm the operationId exists in the generated spec
grep "Create-<slug>-ServiceRequest-V1" openapi-spec.yaml
```

The spec is generated from Dataverse, not hand-edited, and the generator runs asynchronously — the new `operationId` can take roughly 30 seconds to appear. If the grep returns nothing, wait briefly and re-run.

If it still doesn't appear, refresh the spec from Dataverse locally:

```bash
npx tsx scripts/d365/fetch-service-definitions.ts
npx tsx scripts/d365/snapshot-bundled-spec.ts
node scripts/slice-services.mjs --slug <slug>
```

The third command writes `public/services/<slug>/spec.yaml`, the per-service slice the runtime loads. Confirm the file exists and contains the new `operationId` before declaring the service done.

## Plan-mode output

When this skill runs under plan mode, the plan file must contain only these blocks, in this order:

1. **Service summary** — slug, title, pattern, domain, page count, and whether the service is **Dataverse-backed** or **form-only**.
2. **Pages** — bullet list of `NN-<topic>.md` filenames with the question being asked on each page.
3. **Dataverse schema preview** (Dataverse-backed only) — a markdown table with one row per field: `name`, `type`, `required`, `values` (for `Choice`). This is the `lcc_servicedataschema` the skill will write — the user signs off on it here, not after the fact.
4. **Files to create** — explicit paths under `public/services/<slug>/` and `scripts/d365/`.
5. **Commands the user will run** — the dry-run, the `--commit`, and the spec-verify grep.

Do **not** paste full file contents into the plan. The plan is decisions; execution writes the files.

## Delete a service

The skill also handles removal. Auto-invoked when the user says "delete / remove / retire / decommission / take down" a service by name or slug.

### Workflow

1. **Resolve the slug.** Read `public/services/<slug>/service.json` to surface the title. Abort if the folder doesn't exist — print the closest matches under `public/services/` and ask.
2. **Look up the Dataverse row.** Run a one-off query (or scaffold a script using `templates/delete-service-definition.ts`) that filters `lcc_servicedefinitions` by `lcc_servicetype eq '<slug>'` and selects `lcc_servicedefinitionid`, `createdon`, `modifiedon`, `lcc_servicedisplayname`. If no row exists, the delete is local-only — go straight to step 5.
3. **Compute age.** `now - createdon`.
4. **Show the user what they're deleting:**
   - Service title and display name from Dataverse.
   - Slug, Dataverse row id.
   - `createdon` and `modifiedon` (formatted as `YYYY-MM-DD`).
   - Age in days (round down). Phrase clearly: "created 63 days ago".
   - Page count under `public/services/<slug>/`.
   - Whether `openapi-spec.yaml` currently carries the `operationId`.
5. **Run the safety gate:**
   - **Hot delete (age ≤ 24 h):** dry-run first with no flags. Confirm with `--commit`. Single flag is enough — the service is fresh.
   - **Cold delete (age > 24 h, or `lcc_servicedefinition` was modified more recently than `createdon` by ≥ 1 day):** **be very careful**. Require **both** `--commit` and `--confirm-old`. Without `--confirm-old`, the script aborts with a message that names the creation date in absolute form, e.g.:
     > This service was created on 2026-03-12, about 63 days ago, and last modified on 2026-04-29. Deleting it removes the Dataverse row and the `public/services/<slug>/` folder, and the `operationId` will disappear from the next spec generation. Re-run with `--commit --confirm-old` to proceed.
   - In all cases, never delete without a flag — `--commit` is mandatory.
6. **On commit:**
   - DELETE the Dataverse row via `d365Fetch` with `method: 'DELETE'` against `lcc_servicedefinitions(<row-id>)`.
   - Remove the local `public/services/<slug>/` folder (`fs.rm` with `recursive: true`).
   - Tell the user to re-run `npx tsx scripts/d365/snapshot-bundled-spec.ts` so the spec drops the orphan `operationId`.
   - Tell the user to commit the deletion on their current draft branch with a message like `Retire '<service title>'`.

### Template

`templates/delete-service-definition.ts` — sibling to the create template. The skill copies it to `scripts/d365/delete-<slug>.ts` and edits the `SLUG` constant. The `--commit` and `--confirm-old` flags live in the template; do not parameterise them away.

### What delete does not touch

- **Welsh translations** under `public/services/<slug>/cy/` get removed alongside the English folder — they live inside the slug folder.
- **Open pull requests** that reference the slug are not closed automatically. If the user is mid-flight on a feature branch for this service, tell them the branch will be orphaned; they should delete it themselves.
- **Live citizen sessions** holding state for this service. There is nothing the skill can do about these — flag it once so the user can pick the right time to retire.

## What this skill does not do

- It does not write a new entry into the OpenAPI spec. The spec is generated from the Dataverse `lcc_servicedataschema`, which is why step 6 has to happen for the `operationId` to come online. The skill produces the CLI script that triggers that process; running it is the user's call.
- It does not publish to live. Going live is a Preview → Live PR approved in the editor.
- It does not translate to Welsh. Add `titleCy` and `descriptionCy` to `service.json` only if the user supplies translated copy. Do not machine-translate inline.
- It does not invent Dataverse columns it does not know about. The full `lcc_servicedefinition` schema lives in the sibling `dataverse-contact-api` repo. If the user asks for a column not in the template, suggest they check that repo first.

## When you are done

Tell the user, in one or two sentences:

- The slug, page count, and folder path you created.
- That the Dataverse CLI is scaffolded but unrun, and the exact dry-run command.
- Anything in the audit you could not resolve.

Do not paste the full content of the generated files back — the user will read them in the editor.
