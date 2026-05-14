# service.json schema

Mirrors the Zod schema in `api/_lib/serviceSchema.ts`. The audit script (`npm run audit:services`) runs this validator and emits warnings — fix every warning before saving.

## Required-by-convention fields

These aren't enforced by Zod (everything is optional at the schema layer to tolerate legacy fixtures), but every new service should set them:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string, kebab-case | Must match the folder name. `^[a-z][a-z0-9-]*$`. |
| `title` | string, sentence case | The service name as the citizen sees it. |
| `description` | string, one short sentence | Shown in service lists and the start page. |
| `pages` | array of strings | The page filenames in the journey order. No frontmatter file `service.json`. |
| `domainPrimary` | enum (see below) | The single primary domain. |
| `pattern` | enum (see below) | The service template pattern. |
| `operationId` | string | The OpenAPI operation, format `Create-<slug>-ServiceRequest-V1`. |
| `status` | enum, default `Draft` | One of `Published`, `Draft`, `Under review`, `Retired`. |

## Pattern enum

Pick exactly one. Rule of thumb in the right-hand column:

| Pattern | Use when |
| --- | --- |
| `Apply` | The user is asking for permission, a grant, or a place (school, blue badge, planning). Decision is discretionary. |
| `Book` | The user picks a slot from a calendar (bulk waste collection, room booking, appointment). |
| `Tell` | The user is reporting something to the council. No outcome owed back (flytipping, abandoned vehicle, change of circumstances). |
| `Pay` | The user is settling a known charge (council tax, parking fine, invoice). |
| `Register` | The user is creating an account or registering for an ongoing thing (electoral roll, online account). |
| `Request` | The user is asking for a specific thing to be done or delivered (new bin, garden waste service, name on a list). |
| `Manage` | The user is updating an existing relationship (change address, cancel a service, change a name). |
| `Check` | Read-only lookup (am I eligible, what's my balance, can I park here). |
| `Enquire` | Free-text question to a team. Use sparingly — prefer a structured `Tell` or `Apply` where possible. |
| `Find` | Information-only page that may route to a form or external site. |

## Domain primary enum

The 16 LCC service domains. Use the key (left column) verbatim in `domainPrimary`:

```
Council Tax
Bins & Recycling
Housing
Schools & Education
Adult Social Care
Children & Families
Antisocial Behaviour & Crime
Births, Deaths & Marriages
Parking, Roads & Travel
Benefits & Money
Business & Licensing
Planning & Building
Elections & Democracy
Leisure & Culture
Environmental Health
Your Council
```

Note the ampersands — the key string uses `&`, even though body copy must use "and" per GDS rules. The key is an internal identifier; it round-trips through Dataverse, so the spelling has to stay exact.

## Status enum

`Published` · `Draft` · `Under review` · `Retired`. New services start at `Draft`. Promotion to `Published` happens in the editor's preview screen, not by hand-editing this field.

## Audience enum (optional, repeated)

`Resident` · `Visitor` · `Business` · `Landlord` · `Carer` · `Professional`. Set `audience: ["Resident"]` for most council services.

## Optional sections

### `submission`

```json
{
  "submission": {
    "method": "POST",
    "target": "liquidlogic",
    "targetEndpoint": "${env.LIQUIDLOGIC}/intake/v1",
    "referenceFormat": "LCC-{{yyyy}}-{{nanoid8}}"
  }
}
```

`target` is a freeform string the back-end submission service routes on. `targetEndpoint` supports `${env.VARNAME}` interpolation.

### `confirmation`

```json
{
  "confirmation": {
    "title": "We've got it",
    "summary": "Your reference is {{reference}}. We've sent a copy to {{email}}.",
    "slaText": "You will hear back within 5 working days.",
    "whatHappensNext": "A case worker will read your report and contact you if they need more."
  }
}
```

`summary` and `whatHappensNext` accept Handlebars `{{reference}}` and `{{email}}` placeholders.

### `notifications`

```json
{
  "notifications": {
    "confirmationEmail": {
      "templateId": "gov-notify-template-uuid",
      "subject": "We've got your report"
    }
  }
}
```

### `accessibility`

```json
{
  "accessibility": {
    "wcagLevel": "AA",
    "statementUrl": "/accessibility-statement",
    "languages": ["en", "cy"],
    "saveAndResume": true,
    "autoSaveIntervalSeconds": 30
  }
}
```

Default to `wcagLevel: "AA"` for new services. `AAA` requires extra work; don't claim it unless you've done it.

## Minimal valid example

```json
{
  "operationId": "Create-report-a-flytipping-incident-ServiceRequest-V1",
  "id": "report-a-flytipping-incident",
  "title": "Report a flytipping incident",
  "description": "Tell us about rubbish dumped on land that you do not own.",
  "pages": [
    "01-where.md",
    "02-what.md",
    "03-when.md",
    "04-evidence.md",
    "05-reporter.md"
  ],
  "domainPrimary": "Environmental Health",
  "pattern": "Tell",
  "status": "Draft"
}
```

## Fully-populated example

```json
{
  "operationId": "Create-report-a-flytipping-incident-ServiceRequest-V1",
  "id": "report-a-flytipping-incident",
  "title": "Report a flytipping incident",
  "titleCy": "Adrodd am ddigwyddiad tipio anghyfreithlon",
  "description": "Tell us about rubbish dumped on land that you do not own.",
  "descriptionCy": "Dywedwch wrthym am sbwriel sydd wedi ei adael ar dir nad yw'n eiddo i chi.",
  "pages": [
    "01-where.md",
    "02-what.md",
    "03-when.md",
    "04-evidence.md",
    "05-reporter.md"
  ],
  "domainPrimary": "Environmental Health",
  "domainSecondary": ["Antisocial Behaviour & Crime"],
  "pattern": "Tell",
  "status": "Draft",
  "audience": ["Resident"],
  "languages": ["en", "cy"],
  "estimatedTimeMinutes": 5,
  "submission": {
    "method": "POST",
    "target": "liquidlogic",
    "referenceFormat": "FLY-{{yyyy}}-{{nanoid8}}"
  },
  "confirmation": {
    "title": "We've got your report",
    "summary": "Your reference is {{reference}}. We've sent a copy to {{email}}.",
    "slaText": "You will hear back within 5 working days.",
    "whatHappensNext": "A case worker will read your report and may contact you for more details."
  },
  "accessibility": {
    "wcagLevel": "AA",
    "saveAndResume": true,
    "autoSaveIntervalSeconds": 30
  }
}
```
