# Dataverse schema mapping

How `lcc_servicedataschema` is derived from the gds-form markdown the skill just wrote. Load this when working through step 6 of `SKILL.md` — do not preload.

## The rule, restated

One row in `lcc_servicedataschema` per `fields:` entry across all the page markdown. Plus a trailing `metadata` row.

| From the markdown | To the row |
| --- | --- |
| Field key (last segment of a dot-path) | `name` |
| Field `label` (strip trailing `(optional)`) | `description` |
| Field type — see table below | `type` |
| `required: true` AND no `(optional)` in the label | `required: true` else `false` |
| Enum option `value` strings | `values` (only when `type: Choice`) |
| Composite components | `blockVersion: 1` |
| Repeater / metadata | `listType: "key-value"` |

## Type table

| Markdown override or OpenAPI type | DV `type` | Extra fields |
| --- | --- | --- |
| `string` (default) | `String` | — |
| `string` with `enum` (≤4 → radios, ≥5 → select) | `Choice` | `values: [...]` |
| `boolean` | `Boolean` | — |
| `string` with `format: date` | `Date` | — |
| `number`, `integer` | `Number` | — |
| `component: textarea` | `String` | — (DV does not distinguish single- and multi-line) |
| `component: address-block` | `address` | `blockVersion: 1` |
| `component: file-upload` | `file` | `blockVersion: 1` |
| `component: payment` | (skip — Stripe is its own flow, no DV column) | — |
| `component: repeater` | `list` | `listType: "key-value"`, `blockVersion: 1` |
| `component: email-verify` | `String` | — (the verification is a UI flow, not a DV type) |
| `component: time-select` | `String` | — (the value posted is an `HH:mm` string) |

If you do not recognise the override, default to `String` and add a `<!-- TODO: confirm DV type -->` comment in the markdown for review.

## Worked example 1 — simple text/enum

A small "Request a new bin" form. Markdown has:

```yaml
component: address-block
label: Address the bin is for
field: address
```

```yaml
fields:
  - bin:
      label: Which bin do you need
      type: string
      enum: ['Household', 'Recycle', 'Garden waste', 'Food waste']
      required: true
  - reason:
      label: Why do you need a new bin
      type: string
      enum: ['Damaged', 'Stolen', 'Lost', 'Moved-in', 'Need-additional']
      required: true
  - damage-details:
      label: Tell us how the bin is damaged (optional)
      type: string
      required: false
  - notes:
      label: Anything else we should know (optional)
      type: string
      required: false
```

Derived `lcc_servicedataschema`:

```json
[
  {
    "name": "address",
    "description": "Address the bin is for",
    "type": "address",
    "required": true,
    "blockVersion": 1
  },
  {
    "name": "bin",
    "description": "Which bin do you need",
    "type": "Choice",
    "required": true,
    "values": ["Household", "Recycle", "Garden waste", "Food waste"]
  },
  {
    "name": "reason",
    "description": "Why do you need a new bin",
    "type": "Choice",
    "required": true,
    "values": ["Damaged", "Stolen", "Lost", "Moved-in", "Need-additional"]
  },
  {
    "name": "damage-details",
    "description": "Tell us how the bin is damaged",
    "type": "String",
    "required": false
  },
  {
    "name": "notes",
    "description": "Anything else we should know",
    "type": "String",
    "required": false
  },
  {
    "name": "metadata",
    "description": "An array of key-value pairs to store custom metadata for the request",
    "type": "list",
    "required": false,
    "listType": "key-value",
    "blockVersion": 1
  }
]
```

Same shape as `scripts/d365/ensure-request-new-bin.ts` lines 21–63 — the canonical reference. Keep that file open when in doubt.

## Worked example 2 — composite (address + photo)

A "Report a pothole" form using `address-block` and `file-upload`. Markdown:

```yaml
component: address-block
label: Where is the pothole?
field: address
```

```yaml
fields:
  - severity:
      label: How big is it?
      type: string
      enum: ['Small', 'Medium', 'Large']
      required: true
```

```yaml
component: file-upload
label: Photo of the pothole (optional)
field: photo
accept: image/jpeg,image/png
```

Derived schema:

```json
[
  {
    "name": "address",
    "description": "Where is the pothole?",
    "type": "address",
    "required": true,
    "blockVersion": 1
  },
  {
    "name": "severity",
    "description": "How big is it?",
    "type": "Choice",
    "required": true,
    "values": ["Small", "Medium", "Large"]
  },
  {
    "name": "photo",
    "description": "Photo of the pothole",
    "type": "file",
    "required": false,
    "blockVersion": 1
  },
  {
    "name": "metadata",
    "description": "An array of key-value pairs to store custom metadata for the request",
    "type": "list",
    "required": false,
    "listType": "key-value",
    "blockVersion": 1
  }
]
```

## Three rules that catch most mistakes

1. **Names match the markdown key, not the label.** `address`, `bin`, `severity` — never `which-bin-do-you-need`.
2. **`required` is driven by the `(optional)` suffix on the label**, not by the markdown's `required:` flag alone. Labels are what the user sees; trust them.
3. **The trailing `metadata` row is always there**, even if no question uses it. The back-end relies on it.
