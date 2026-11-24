# Step 4 — publishing the portal's tables

_Part of the `build-portal` skill. Read it at step 4, before saving or publishing any table. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

Follow ONE of the paths below for each table the portal needs that isn't published yet, in priority order, then put the schema through *Before you publish* at the end of this file.

## Path A — Use a reference schema (MANDATORY for case portals)

For **case portals**, ALWAYS use these exact schemas. Do NOT scaffold `incident` or `annotation` from discovery — the scaffolder gets the join paths, filters, and polymorphic lookups wrong.

Publish `case` first, then `casenotes`. The **route name is `case`** — the
Dataverse table is `incident`, but the route the SDK and the generated frontend
call is `case`, matching the platform's own `case.schema.json`. Publish it as
`incident` and every read and write in the scaffolded portal 404s. The draft key
and the `--tables` value must both be the route name, or `publish` finds no
draft:

```bash
contact-admin tables save-draft case --schema '<CASE_SCHEMA>' --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables publish --tables case --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables save-draft casenotes --schema '<CASENOTES_SCHEMA>' --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables publish --tables casenotes --url "${API_URL}" --scope "${TARGET_SCOPE}"
```

**CASE_SCHEMA** — the `case` route over the Dataverse `incident` table:
```json
{"routeName":"case","description":"Cases and support tickets","dataverseTable":"incidents","dataverseLogicalName":"incident","requiredPermission":"case","primaryKey":"incidentid","aliases":["incident","incidents","cases"],"defaultSelect":["incidentid","title","ticketnumber","statecode","statuscode","prioritycode","casetypecode","createdon","modifiedon"],"contactJoinPath":[{"table":"contacts","from":"customerid_contact","key":"contactid"}],"alternateContactJoinPaths":[[{"table":"contacts","from":"primarycontactid","key":"contactid"}]],"teamJoinPath":[{"table":"accounts","from":"customerid_account","key":"accountid"}],"createDefaults":[{"field":"customerid_account","bindTo":"account","entitySet":"accounts"},{"field":"primarycontactid","bindTo":"contact","entitySet":"contacts"}],"lookupFields":["ticketnumber","title"],"lookupSearchContains":["ticketnumber","title"],"filters":["statecode eq 0"],"fields":{"incidentid":{"type":"string","description":"Unique case identifier","readOnly":true},"ticketnumber":{"type":"string","description":"Case number","readOnly":true},"title":{"type":"string","description":"Case title"},"description":{"type":"string","description":"Case description"},"statecode":{"type":"choice","description":"Case status","readOnly":true},"statuscode":{"type":"choice","description":"Status reason","readOnly":true},"prioritycode":{"type":"choice","description":"Priority","readOnly":true},"casetypecode":{"type":"choice","description":"Case type"},"caseorigincode":{"type":"choice","description":"Case origin"},"createdon":{"type":"datetime","description":"Date created","readOnly":true},"modifiedon":{"type":"datetime","description":"Date last modified","readOnly":true},"customerid":{"type":"lookup","description":"Customer (contact or account)","readOnly":true},"primarycontactid":{"type":"lookup","description":"Primary contact","lookupTable":"contact","readOnly":true},"ownerid":{"type":"lookup","description":"Record owner","readOnly":true}}}
```

Why this schema matters:
- `routeName` is `case`, and `aliases` keep `incident`/`incidents`/`cases` working for anyone who guesses the Dataverse name. `requiredPermission` is `case`, so the permission strings in step 10 are `case`, `case:write`, `case:create`, `case:lookup`
- `contactJoinPath` uses `customerid_contact` — NOT `responsiblecontactid` or `ownerid` which the scaffolder picks and which returns no data for `/me` routes
- `createDefaults` auto-binds the logged-in user's contact and account when creating cases
- Status, priority and the contact link are `readOnly`: a citizen raises and describes a case, staff triage and close it. `primarycontactid` is read-only *because* `createDefaults` binds it — the default only applies on create, so a writable field would let the caller re-point it afterwards. The API drops read-only fields silently rather than erroring, so build no UI that edits them
- `filters: ["statecode eq 0"]` shows only active cases

**CASENOTES_SCHEMA** — annotations filtered to cases (route name is `casenotes`, NOT `annotation`):
```json
{"routeName":"casenotes","description":"Notes and annotations linked to cases","dataverseTable":"annotations","dataverseLogicalName":"annotation","requiredPermission":"casenotes","primaryKey":"annotationid","aliases":["casenote"],"defaultSelect":["annotationid","subject","notetext","incidentid","isdocument","createdon","modifiedon"],"contactJoinPath":[{"table":"incidents","from":"objectid_incident","key":"incidentid"},{"table":"contacts","from":"customerid_contact","key":"contactid"}],"alternateContactJoinPaths":[[{"table":"incidents","from":"objectid_incident","key":"incidentid"},{"table":"contacts","from":"primarycontactid","key":"contactid"}]],"teamJoinPath":[{"table":"incidents","from":"objectid_incident","key":"incidentid"},{"table":"accounts","from":"customerid_account","key":"accountid"}],"filters":["objecttypecode eq 'incident'"],"parentTable":{"table":"case","navigationProperty":"objectid_incident"},"lookupFields":["subject"],"lookupSearchContains":["subject"],"fields":{"annotationid":{"type":"string","description":"Unique note identifier","readOnly":true},"subject":{"type":"string","description":"Note subject / title"},"notetext":{"type":"string","description":"Note body text"},"isdocument":{"type":"boolean","description":"Whether the note has a file attachment","readOnly":true},"filename":{"type":"string","description":"Attachment file name","readOnly":true},"filesize":{"type":"number","description":"Attachment file size in bytes","readOnly":true},"mimetype":{"type":"string","description":"Attachment MIME type","readOnly":true},"incidentid":{"type":"lookup","description":"Parent case","lookupTable":"incident","valueField":"objectid","bindField":"objectid_incident"},"objecttypecode":{"type":"string","description":"Regarding entity type","readOnly":true},"ownerid":{"type":"lookup","description":"Record owner","readOnly":true},"createdon":{"type":"datetime","description":"Date created","readOnly":true},"modifiedon":{"type":"datetime","description":"Date last modified","readOnly":true}},"files":{"content":"documentbody","fileName":"filename","mimeType":"mimetype","size":"filesize"}}
```

Why this schema matters:
- Route name is `casenotes` — do NOT publish a generic `annotation` route
- `lookupTable` uses `"incident"` (the Dataverse logical name) so it resolves in any scope. `parentTable.table` is different on purpose — it names the **route** (`case`), not the logical name
- `incidentid` has `valueField: "objectid"` and `bindField: "objectid_incident"` for the polymorphic lookup — without this, writes fail with "Invalid property 'incidentid'"
- `contactJoinPath` is two hops: annotation → incident → contact (via `customerid_contact`)
- `filter: ["objecttypecode eq 'incident'"]` restricts to case-linked notes only
- The join reaches **every** note on the citizen's case — including ones staff wrote for each other. Ask whether that's acceptable before publishing. If the organisation marks customer-facing notes somehow (a flag, a prefix its staff already use), add it to `filters` and prove it with `test-query`; if not, tell the user plainly that staff notes on a case will be visible to the customer
- `files` serves a note's attachment as a 5-minute download link (API 1.31.0+), and keeps `documentbody` out of the fields so it can never come back inline. Show `filename` and `filesize`, and fetch the link when the citizen clicks (see *Files: link on click, never inline* in `references/code-security.md`, and `downloadFile` in `references/sdk-usage.md`). On an older deployment the PUT refuses `files`: drop the key, and show attachments as names only
- Grant `casenotes:create`, not `casenotes:write` (step 10). Adding a note needs only `create`; `write` would let a citizen edit any note the join reaches, staff ones included

For the frontend, scope child records to their parent:
```ts
const notes = await client.me.list<Casenotes>("casenotes", {
  filter: { field: "incidentid", operator: "eq", value: caseId },
});
```

## Path B — Copy from default scope

For tables NOT covered by the reference schemas above, check if the default scope has a working config:

```bash
contact-admin tables get <routeName> --url "${API_URL}" --scope default --json
```

If found, check any `lookupTable` values in the fields — change them to the Dataverse logical name (e.g. `"incident"` not `"case"`) so they resolve in any scope. A copied definition was written for another scope's portal and another scope's defaults, so put it through **Before you publish** line by line. Then save and publish:

```bash
contact-admin tables save-draft <routeName> --schema '<the-schema-json>' --url "${API_URL}" --scope "${TARGET_SCOPE}"
contact-admin tables publish --tables <routeName> --url "${API_URL}" --scope "${TARGET_SCOPE}"
```

## Path C — Scaffold from discovery (last resort)

Only use this for tables that have no reference schema AND don't exist in the default scope. **Scaffold, review, then publish — never let the scaffolder publish for you.** A scaffold lists every column the entity has, marks none of them `readOnly` and gives no lookup a `lookupTable`. Published as it stands, it lets anyone holding `write` change every column on their rows — status, owner and custom fields included — and point lookups anywhere. `setup-table` publishes by default, so always pass `--no-publish`:

```bash
# Scaffold and save a DRAFT — nothing is reachable yet
contact-admin setup-table <entity> --no-publish --url "${API_URL}" --scope "${TARGET_SCOPE}" --json
```

Then take the draft through **Before you publish**: cut `fields` down to what the portal shows or writes, mark the rest of what remains `readOnly` where the citizen must not change it, and give each lookup the portal writes a `lookupTable`. Save the edited schema with `tables save-draft` and publish it with `tables publish` (the granular commands below).

**Join-ambiguity handling:** If the response includes `joinAnalysis.contactJoinAmbiguous: true` or `joinAnalysis.accountJoinAmbiguous: true`:

1. Run `contact-admin tables sample-data <entity> --top 3 --json` to inspect the chosen join's lookup values.
2. **Pause and ask the user** in one sentence, e.g.:
   > "On `incident` I found two contact joins: `customerid → contact` and `ownerid → contact`. The scaffold picked `customerid`. Sample rows show `customerid` = [Alice, Bob, (null)]. Confirm, or say which to use."
3. If the user picks a different join, use the granular commands:
   ```bash
   contact-admin tables scaffold <entity> --json   # get the schema
   # modify schema.contactJoinPath / schema.teamJoinPath
   contact-admin tables save-draft <routeName> --schema '<modified-json>'
   contact-admin tables publish --tables <routeName>
   ```

**Empty-table case:** if `sample-data` returns `count: 0`, don't block. Tell the user: "No rows in `<entity>` yet — join was chosen from metadata only; double-check once real data lands."

## Before you publish

The API enforces exactly what a schema declares, on every request, whatever the portal does. So a schema can work perfectly and still leak. Check each one before `tables publish`:

| Check | Why |
|---|---|
| `fields` holds only what this portal shows or writes | Anyone who can read the route can `select` and `filter` on every column in `fields`, whatever `defaultSelect` says. Leave out internal notes, risk or safeguarding flags, staff-only comments |
| Everything the citizen must not change is `readOnly: true` — identifiers, status and priority, owner, dates, and above all the identity columns: `emailaddress1` (the API matches the sign-in email to it), the company link `parentcustomerid`, any column a join path follows, every field a `createDefaults` entry binds | A field is writable unless it says otherwise, and the API drops read-only fields silently |
| Every lookup is `readOnly` unless the citizen has to choose it, and each one they do choose has a `lookupTable` naming a route published in this scope | `readOnly` is the control that always holds. For a lookup the citizen sets, `lookupTable` is what lets the API check the target row belongs to them; without it, nothing checks |
| `defaultSelect` is not empty, and every expand lists its fields | An empty list means "no projection", not "nothing" |
| No expand reveals more than the parent should — a staff member's email via `ownerid`, another customer's details | An expand returns its fields from whatever row the lookup points at, with no scoping of its own |
| No `publicRead` or `publicCreate` unless the user asked for an unauthenticated route | Public means anyone on the internet. Never add it to make an auth problem go away |
| No `fetchXml` unless the template scopes itself with `{{contactid}}` / `{{accountid}}` | A FetchXML template replaces the join path *and* the route's `filters` |
| Notes and activities: decide whether staff-written rows should be visible | A child joined through the case reaches every child of that case |

Path A's schemas already pass these, notes caveat aside. Paths B and C produce schemas written for someone else's portal or by a generator, and need the check line by line.
