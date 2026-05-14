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

`field:` MUST point at a schema object — the DV row must be `{name: <field>, type: address, blockVersion: 1}`. The merger looks for child sub-fields under the parent; a flat `String` row makes the page render blank. To capture **only a postcode** (e.g. "where do you work?"), still use `type: address` — AddressBlock degrades gracefully when only the postcode sub-field is populated.

### `map-picker`

Drag-and-drop pin on an embedded map.

```yaml
component: map-picker
label: Where would you like a tram stop?
field: preferred_stop
```

Composite — shares AddressBlock's `FIELD_ROLES`. Same schema rule: the DV row is `{name: <field>, type: address, blockVersion: 1}`. A flat `String` schema row makes the page render blank.

### `email-verify`

Email + one-time code verification flow.

```yaml
component: email-verify
label: Your email address
field: applicant.email
```

### `payment` (fixed amount)

Stripe fee collection for a set charge — application fee, delivery charge.

```yaml
component: payment
amount: 75.00
currency: GBP
description: Application fee
```

No DV row needed for the payment block itself.

### Variable-amount payment (`payment: true` on a field)

When the user enters an amount that the site then charges. No separate `component: payment` page — Stripe renders on check-answers and sums every `payment: true` field across the journey.

```yaml
fields:
  - sponsorship_amount:
      label: How much would you like to contribute?
      hint: Enter an amount in pounds, for example 25.00
      type: number
      payment: true
```

Schema row: `{name: sponsorship_amount, type: Number}`. The field MUST be `type: number` — `collectPaymentItems()` in `src/utils/checkAnswers.ts` reads `parseFloat` and multiplies by 100 for pence.

Fixed and variable can coexist (variable sponsorship + fixed delivery fee), but pick one for any single "ask for an amount" intent.

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
