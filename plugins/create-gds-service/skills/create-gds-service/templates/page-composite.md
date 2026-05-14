# <Page title — sentence case>

<Optional one-sentence guidance. Delete the line if not needed.>

```gds-form
component: address-block
label: <e.g. "Delivery address" or "Where did it happen?">
field: <object path in the schema, e.g. "location" or "applicant.address">
```

<!--
Other composite components — pick one and delete the rest:

# Email with one-time code
```gds-form
component: email-verify
label: Your email address
field: applicant.email
```

# Single file upload (use `multiple: true` for several files)
```gds-form
component: file-upload
label: Photo of the damage
field: evidence
accept: image/jpeg,image/png
capture: environment
multiple: false
```

# Time picker (interval is 60, 30, or 15 minutes)
```gds-form
component: time-select
label: When did it happen?
field: incident_time
interval: 30
```

# Repeating sub-form
```gds-form
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

# Stripe payment
```gds-form
component: payment
amount: 75.00
currency: GBP
description: Application fee
```
-->
