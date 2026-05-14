# Component cheatsheet

How the merger (`src/merger/mergeModel.ts`, function `resolveComponentType`) picks a component from the OpenAPI field type. Mirror these defaults — override only when you need to.

## Auto-resolution from schema type

| OpenAPI type | Condition | Component |
| --- | --- | --- |
| `enum` | 4 or fewer values | `radios` |
| `enum` | 5 or more values | `select` |
| `boolean` | required | `radios` (real Yes/No question, no default) |
| `boolean` | optional | `checkbox` (tick if true) |
| `string` | format `date` | `date-input` |
| `string` | format `email` | `text-input` (with email keyboard) |
| `number`, `integer` | any | `text-input` (numeric keyboard) |
| `string` | default | `text-input` |

## Overriding auto-resolution

Set `component:` in the gds-form override block. The merger trusts your override, so use it sparingly:

| Override to | Use when |
| --- | --- |
| `textarea` | The string is long-form (description, notes, "tell us more"). |
| `checkbox` | A required boolean is actually a declaration ("I confirm…"), not a Yes/No question. |
| `radios` | An optional boolean still needs an explicit Yes/No (rare). |
| `select` | An enum has ≤4 values but the labels are long and crowd the page. |

If the override is in this list and matches `resolveComponentType`'s rules in `src/merger/mergeModel.ts` lines 150–155, the merger keeps it. If it doesn't, you'll get a warning at parse time.

## Composite components (non-OpenAPI)

These are first-class components that bundle multiple fields and have their own platform logic. They live in `src/components/gds/` and are documented in `src/parser/markdown/parseMarkdown.ts`.

### `address-block`

Postcode lookup with manual fallback. One block fills postcode, line 1, line 2, town, county.

```yaml
component: address-block
label: Delivery address
field: address
```

Use a single `field:` when the OpenAPI schema has a nested `address` object. Use `fields:` to map sub-fields explicitly when the schema is flat.

### `email-verify`

Email + one-time code verification flow.

```yaml
component: email-verify
label: Your email address
field: applicant.email
```

### `payment`

Stripe fee collection.

```yaml
component: payment
amount: 75.00
currency: GBP
description: Application fee
```

### `file-upload`

```yaml
component: file-upload
label: Photo of the damage
field: evidence
accept: image/jpeg,image/png
capture: environment
multiple: false
```

`capture: environment` triggers the rear camera on mobile. Drop it for desktop-first flows.

### `time-select`

```yaml
component: time-select
label: When did it happen?
field: incident_time
interval: 30
```

`interval` is one of `60`, `30`, `15` minutes. Defaults to `30` if omitted.

### `repeater`

Add-to-a-list of inline sub-forms.

```yaml
component: repeater
name: dependants
itemLabel: Dependant
minItems: 1
maxItems: 6
subFields:
  - dependants[].first_name
  - dependants[].last_name
  - dependants[].date_of_birth
titleFields:
  - first_name
  - last_name
```

## Don't invent components

The list above plus the auto-resolution table is the full set. If a question doesn't fit any of these, fall back to a plain text-input and flag it in the page with a `<!-- TODO: -->` comment for review.
