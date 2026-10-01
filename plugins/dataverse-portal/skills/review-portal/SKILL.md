---
name: review-portal
description: Review an existing React portal built on the Dataverse Contact API — a whole repo or a pull request — for security and best-practice problems, and report each with severity, file:line and the fix. Covers which tier the code calls (client.all in a citizen portal), HTML rendering and links built from data, secrets in VITE_* variables, .env files and the built bundle, MSAL token cache and sign-out, raw API errors shown to citizens, route params passed to the SDK, TanStack Query keys under a company switcher, analytics and session replay, security headers / CSP, and — from the scope's public schema — writable identity columns and public routes. Use when the user asks to review, audit, security-check or go-live-check a portal, React app or SPA that uses @truenorth-it/dataverse-client or the Contact API, e.g. "review my portal", "is this portal safe to go live", "security review this React app", "check this portal PR", "bring this portal up to the dataverse-portal standard". Report-only unless the user asks for fixes.
---

# review-portal

The Contact API enforces row scoping, permissions and column write rules on
every request, so a portal can't make it return more than the scope allows. A
portal can still do plenty of damage on its own side of the line. It can run
attacker HTML in the citizen's session, ship a secret in its bundle, widen the
tier to make an error go away, leave the last person signed in on a library PC,
or faithfully display staff-only data that the scope exposes.

This skill reviews an existing portal against the rules `build-portal`
generates code to (its *Security — what the generated code must not do*
section), and reports what it finds with the fix. It is report-only until the
user asks for changes.

## What it needs

- **Reviewing code:** nothing. No credentials, no network.
- **The schema check (optional):** network, nothing else. It reads the scope's
  published schema, which is public.
- **The scope's negative test:** an admin credential. Recommend it; run it only
  if the user supplies one.

## 1. Establish what is under review

- **A whole repo.** Find the portal root: the `package.json` that depends on
  `@truenorth-it/dataverse-client` and/or `@azure/msal-browser`. If neither is
  there, it isn't a Contact API portal. Say so and stop.
- **A pull request.** Get the diff (`gh pr diff <n>`, or `git diff <base>...HEAD`).
  Scan the whole repo, but report findings on changed lines, plus repo-wide ones
  the change affects (a new `VITE_*` variable, a new route, a removed header).
- **Who uses it.** A citizen portal (mostly `client.me`) and a business or staff
  portal (`client.team`, sometimes `client.all`) judge tier findings
  differently. Infer it from the code and say what you inferred in one
  sentence, rather than asking.

## 2. Run the scanner

```bash
node <this skill's directory>/scripts/scan.mjs --root <portal> --schema
```

It walks the source, `.env*` files, `.gitignore`, the host config and any built
`dist/`, and prints candidates grouped by severity. `--schema` also reads
`${VITE_API_BASE_URL}/api/v2/${VITE_API_SCOPE}/schema` (public, no credentials);
drop it when offline, or pass `--api` / `--scope` when the `.env` doesn't name
them. `--json` gives machine-readable output, and `--strict` exits 1 on any high
finding, for CI.

It never prints a secret's value, only the variable's name. The path is
relative to this skill's directory, not the user's project — invoke it with the
skill's absolute path.

## 3. Confirm every candidate

A pattern match is a lead, not a finding. Open each location and decide, using
`references/checks.md` — keyed by the same ids, with what to look for, when it
is a false positive, and the fix. The judgements that come up most:

- **`tier-all`.** Right in a staff tool; a finding in a citizen flow, where it
  usually means a join or contact problem was papered over.
- **`html-sink`.** Trace the value. From the API — a note, an email body, an
  article — it is a finding. A constant is not.
- **`raw-error`.** Does the text reach a citizen's screen, or only a console or
  a developer page?
- **`vite-key`.** A publishable key (map tiles) is fine; anything else is a
  secret in the bundle.
- **`route-param`.** Does the id actually reach `client.*.get` / `update`
  unchecked?

Drop false positives without comment. A report padded with non-issues teaches
people to skim it.

## 4. Check what the scanner can't

Each is a quick read of one or two files:

| Check | Look at |
|---|---|
| Sign-out is one click from every page | The header / user menu: a visible control that calls `logoutRedirect` |
| Realtime handlers only invalidate | Any SignalR / `useRealtime` handler: it must refetch, never render the event |
| Switching company refetches cleanly | The switcher: keys carry the company id, or the cache is cleared on switch |
| A missing contact gets its own screen | A 404 `No Dataverse contact found` is handled as "signed in as someone we don't know", not a generic error |
| Authenticated custom APIs send a token | `client.public.invoke*` used for an action that isn't `publicInvoke` will 401. The fix is a token, not `publicInvoke` |
| The dev token is dev-only | `VITE_DEMO_TOKEN` gated by `import.meta.env.DEV`, and only in `.env.development.local` |
| Public forms aren't relying on the page | An anonymous POST "protected" by a client-side CAPTCHA has no protection; rate limiting belongs at the edge |

## 5. The scope behind it

- **From `--schema`:** the `schema-*` findings — a writable `emailaddress1` or
  company link, `createDefaults` fields left writable, lookups without a
  `lookupTable`, an empty default select, public routes. These are the
  scope's, not the portal's; say so, and name who fixes them (Terraform or the
  Table Manager).
- **The negative test,** for each route the portal calls, needs an admin
  credential:
  ```bash
  contact-admin tables test-query <route> --tier me --contact-id <a GUID matching nobody>
  ```
  It must return 0 rows. Recommend it; run it only with a credential the user
  supplies.
- **A Terraform repo for the scope?** Hand off to the `dataverse-terraform`
  plugin's security pass rather than re-reviewing it here.

## 6. Report

Lead with what matters. One paragraph, then one table, then what wasn't
checked:

```markdown
## Portal review — <portal>, <date>

<What it is (citizen or business, tier), the headline risk in one sentence,
and the counts: N high, N medium, N low.>

| # | Severity | Finding | Where | Fix |
|---|---|---|---|---|
| 1 | High | Case notes rendered through a hand-written sanitiser | `src/components/CaseNotesPanel.tsx:179` | DOMPurify, via one `SafeHtml` component |

### Not checked
- The app registration: implicit grant, redirect URIs, localhost on the production registration
- The identity provider: email verification, sign-up policy
- Headers set at the edge rather than in the repo
- The scope's baseline and per-person grants (needs an admin credential)
```

Severity:

| | Means | Typical |
|---|---|---|
| **High** | Someone else's data or session is at risk, or a secret is exposed | HTML sink on API data; `client.all` in a citizen flow; a secret in `VITE_*` or the bundle; an email address sent to analytics; a writable `emailaddress1` or company link in the scope; an empty default select |
| **Medium** | A defence is missing, or detail leaks | No CSP; raw API errors shown to citizens; `localStorage` token cache; no sign-out; route params unchecked; a dynamic `import.meta.env` read; analytics without consent; a tracked `.env`; a persisted query cache |
| **Low** | Hygiene and defence in depth | Popup sign-in; links from data on React < 19; `team` calls to confirm; debug switches; `.gitignore` gaps; status columns writable |

Quote the line behind each finding, and give the smallest fix. The patterns
are in `build-portal`: `SafeHtml`, `safeHref`, the GUID check, `friendlyError`,
`sessionStorage`, and the headers in its `references/security.md`.

## 7. Fixing — only when asked

- One finding at a time, smallest change first, using the `build-portal`
  patterns. Run the project's typecheck and tests after each, then re-run the
  scanner to show the count fall.
- **A secret that has already shipped must be rotated.** Removing the variable
  stops the next build leaking it; it doesn't un-leak the last one. Say that
  before anything else.
- Leave alone: the app registration, the identity provider, and the scope's
  config. Point at the Azure portal, or the `dataverse-terraform` plugin,
  instead of editing around them.

## Where the rules come from

- `build-portal`, in this plugin: the generated-code rules, plus
  `references/security.md` (response headers, go-live checks).
- The `dataverse-contact-api` plugin, if installed: `references/security.md`,
  for what the API enforces versus what it takes on trust — useful when a
  finding needs explaining.
