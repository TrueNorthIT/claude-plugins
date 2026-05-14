# <Page title — sentence case, matches the question label exactly>

<Optional one short paragraph of guidance text. Active voice. Address the user as "you". 25 words or fewer. Delete this line if the question speaks for itself.>

```gds-form
section: <Section heading shown above the field — usually the same as the page title>
fields:
  - <field_path>:
      label: <The question, sentence case. Matches the page title.>
      hint: <Single short sentence with no full stop and no links. Delete this line if there's no hint.>
```

<!--
Notes for the author (delete before saving):
- field_path must exist in openapi-spec.yaml under this service's operationId.
- Component is auto-resolved from the schema type. Override with `component:` only when you must.
- For optional fields, append " (optional)" to the label. Never use asterisks.
- For conditional pages, add `show_when: other_field is "value"` to YAML frontmatter at the top of the file.
-->
