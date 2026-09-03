# dataverse-contact-api

How the [Dataverse Contact API](https://api.dataverse-contact.tnapps.co.uk)
actually works — the platform knowledge you would otherwise have to read the
source to get.

The Contact API puts a citizen-facing HTTP surface in front of Microsoft
Dataverse. A signed-in person gets their own rows, and only their own rows,
without the client ever sending a filter that could be tampered with. This
plugin carries the facts about that surface: the URL shape, the access tiers,
the permission grammar, the query dialect, authentication, the TypeScript SDK,
and how to work out what a failing call is actually telling you.

It is the shared factual foundation its siblings assume. `dataverse-terraform`
defines a scope as code; `dataverse-portal` scaffolds an app against one. This
plugin explains the thing both of them are talking to, and is the one to install
if you are writing a client by hand.

## Install

```bash
claude plugin marketplace add TrueNorthIT/claude-plugins   # once
claude plugin install dataverse-contact-api@truenorthit
```

Or in a session: `/plugin marketplace add TrueNorthIT/claude-plugins` then
`/plugin install dataverse-contact-api@truenorthit`.

The plugin checks for updates at session start and tells you when to run
`/plugin marketplace update truenorthit`.

## What it answers

The skill is auto-invoked — you don't call it by name. It triggers on questions
like:

| Ask | Get |
|---|---|
| "how does the Contact API work?" | The URL shape, the four tiers, and what each one joins on |
| "why is this returning 403?" | Whether it's the permission list, the tier, the cache, or missing defaults |
| "why is my `/me` list empty?" | The join-path diagnosis, and how to prove it without a portal |
| "how do I page through results?" | Cursor paging — and why `skip` is a hard 400 |
| "what permission lets someone edit their colleagues' cases?" | `case:write:team`, and why `case:write` will never do it |
| "how do I authenticate a portal against this?" | Entra External ID, discovery, and the email-claim contact match |
| "how do I call this from TypeScript?" | `@truenorth-it/dataverse-client` — including the package name the docs get wrong |

## What you need

Nothing. There are no credentials, no network calls and no tooling required to
answer a question about how the API behaves.

Credentials only come into it when you want to *run* something — a token to call
a data route, or an admin credential for `/_admin/*`. The skill says which is
which rather than asking for a key to answer a question it can answer from
knowledge.

## Things worth knowing up front

The five that catch out almost everyone writing their first client:

- **There is no `DELETE`.** Not on any data route. Deactivation is a `statecode`
  write, and `incident` needs the `CloseIncident` action even for that.
- **`case:write` is tier `me`.** It can never satisfy `case:write:team`. Tiers
  imply downwards only, and write never implies read.
- **The query dialect is not OData.** No `$` prefix, and paging is cursor-based
  — `skip` is rejected with a 400 telling you to follow `page.next`.
- **The caller is matched to a contact by the lowercased `email` claim**, not
  `oid` or `sub`. A valid token with no matching contact signs in fine and then
  404s on every `/me` route.
- **A scope with no published `defaults.json` grants nothing** — every route,
  reads included, answers `403`. It is the usual reason a new scope arrives
  dead.

## Layout

```
dataverse-contact-api/
├── hooks/                              update check at session start
└── skills/contact-api-reference/
    ├── SKILL.md                        URL shape, tiers, verb matrix, routing
    └── references/
        ├── permissions.md              the grammar, what implies what, the two layers
        ├── querying.md                 filter / orderBy / expand / cursor paging
        ├── auth.md                     Entra External ID, contact resolution
        ├── sdk.md                      @truenorth-it/dataverse-client
        ├── routes.md                   full route surface, envelopes, headers
        ├── troubleshooting.md          whoami-first triage
        └── admin.md                    /_admin, contact-admin CLI, tokens
```

## Related plugins

| For | Use |
|---|---|
| Defining a scope's tables, joins and permissions as code | `dataverse-terraform` |
| Scaffolding a React portal against a scope | `dataverse-portal` |
