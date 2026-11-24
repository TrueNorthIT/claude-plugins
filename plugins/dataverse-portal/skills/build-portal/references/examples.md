# Worked examples

_Part of the `build-portal` skill. Read it at the start, when the request looks like one of these, or a step's choice is unclear. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

## "build me a case portal using https://api.dataverse-contact.tnapps.co.uk"

- `API_URL` = provided; `TARGET_SCOPE` not specified.
- `.well-known` returns `idp_provider: entra-external-id` → Entra path, tenant parsed from `idp_issuer`.
- `contact-admin scopes list` returns: default, case-portal, ...
- Skill asks: "This API has scopes: default, case-portal. Use one of those, or create a new scope?"
- User: "default".
- `contact-admin login --scope default` — stores key.
- `contact-admin tables list` finds existing `case` + `casenotes` — no setup-table needed.
- Scaffolds frontend, then asks for the SPA client ID. One prompt, one browser click, one GUID, done.

## "build me a bookings portal"

- `API_URL` = default; no scope in prompt.
- `contact-admin scopes list` returns: default.
- Skill asks: "Put this in `default` or create a new scope `bookings`?"
- User: "new scope called `bookings-pilot`".
- `contact-admin login --scope bookings-pilot` — scope auto-created on approval.
- `contact-admin setup-table msdyn_bookableresourcebooking --no-publish` — scaffolds and saves a draft. The skill trims `fields` to what a booking list and detail need, marks status, owner and the resource lookup `readOnly`, then `tables save-draft` and `tables publish`.
- `tables test-query <route> --tier me --contact-id <a GUID matching nobody>` returns nothing, so the join filters.
- Scaffolds portal with `VITE_API_SCOPE=bookings-pilot`, so the SDK targets `/api/v2/bookings-pilot/`. The Entra API scope is unchanged — one `api://<api-app-id>/access_as_user` token is valid across every scope on the deployment that doesn't override the OIDC settings. The flip side: users of other portals on the deployment hold tokens `bookings-pilot` also accepts, which is one more reason its baseline holds nothing ending in `:all`.

## "build me a case portal in scope case-portal"

- Scope explicitly named.
- `contact-admin login --scope case-portal` — scope auto-created on approval if it doesn't exist.
- `tables list` shows neither route, so Path A: publish `CASE_SCHEMA` then `CASENOTES_SCHEMA` exactly as written in `references/tables.md` (step 4). Not the `case` / `casenotes` in `default` — those leave status, priority and the contact link writable.
- Before you publish: the reference schemas pass, apart from the notes question. The skill asks whether staff-written notes on a case may be visible to the customer, and says plainly that they will be unless the organisation marks customer-facing notes.
- `tables test-query case --tier me --contact-id <a GUID matching nobody>` and the same for `casenotes` both return nothing.
- Do NOT also publish a generic `annotation` route — `casenotes` is the filtered alias that should be used.
- Scaffolds frontend. In step 10 the starter grant is `case`, `case:write`, `case:create`, `case:lookup`, `casenotes`, `casenotes:create` — no `casenotes:write`.

## Ambiguous contact join — confirmation flow

- User: "build me a portal for the `tn_project` table in scope `pm`".
- Skill hits step 4.2: `scaffold_table({ entity: "tn_project" })` returns `joinAnalysis.contactJoinAmbiguous: true` because the entity has `ownerid → contact` and `tn_projectleadid → contact`.
- Step 4.3: `sample_data({ entity: "tn_projects", top: 3 })` returns 3 rows. Skill pulls out the `tn_projectleadid` values (the scaffolder's pick) — they look populated.
- Step 4.4: skill asks in one sentence: "I found two contact joins on `tn_project`: `tn_projectleadid → contact` and `ownerid → contact`. I'm picking `tn_projectleadid`. Sample rows show `tn_projectleadid` = [Sam, Jo, Priya]. Confirm, or say which to use."
- User: "use ownerid". Skill mutates `schema.contactJoinPath` to the `ownerid` candidate's path, takes the schema through **Before you publish** (trim `fields`, `readOnly` on status, owner and the join columns), then `save_table_draft` + `publish_tables`, then the negative `test-query`.

## Brand-new empty table

- User: "build me a portal for `tn_expense` in scope `expenses`".
- Steps 4.1 + 4.2 run normally; `joinAnalysis.contactJoinAmbiguous: false` (only one direct lookup).
- Step 4.3: `sample_data` returns `count: 0`. Skill prints: "No rows in `tn_expense` yet — skipping data-level join verification. The join was chosen from metadata only; double-check once real data lands."
- Step 4.4 fast-path: "Using `tn_contactid` → contact (metadata only — empty table)." Continues without asking.
