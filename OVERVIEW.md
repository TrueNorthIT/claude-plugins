# claude-plugins (TrueNorth IT Claude Code Marketplace)

## What it does — user, customer & business value

This repository is TrueNorth IT's Claude Code plugin marketplace: a catalogue of
AI-assisted developer tooling for building against TrueNorth services. It ships
five plugins, each installed, versioned and updated on its own — adding the
marketplace installs nothing by itself.

| Plugin | What it does |
|---|---|
| `dataverse-contact-api` | The factual reference for the Dataverse Contact API — the `me`/`team`/`all`/`public` tiers, the permission string grammar, the non-OData query dialect, Microsoft Entra External ID auth, the SDK, and 401/403/404 triage. The shared ground the two below assume. |
| `dataverse-terraform` | Defines a portal backend — a *scope* — as Terraform: which Dataverse tables publish as routes, which fields each exposes, how rows scope back to the signed-in citizen, and the baseline permissions. Also exports an existing scope into HCL, and explains a config in plain English. |
| `dataverse-portal` | Turns a single natural-language prompt ("build me a case portal", "scaffold a UI for the booking table in scope pilot") into a working citizen-facing React + TypeScript + Tailwind SPA, signed in with Microsoft Entra External ID via MSAL and wired to the Contact API. |
| `create-gds-service` | Scaffolds or removes a GOV.UK Design System service in a service-builder-flow repo — folder, pages, GDS-compliant copy, Dataverse row CLI, OpenAPI verification. |
| `bigmac` | Offloads grunt work (summaries, first-pass code exploration, bulk classification, rough drafts) to the office Ollama server rather than to frontier tokens. |

The users are developers — in-house, partner, or council — working in Claude
Code. The problem the Dataverse plugins solve is the cost and inconsistency of
hand-building a portal backend and frontend for each local authority service.
Between them they cover the whole path: understand the API, publish the scope,
scaffold the app against it. For a local authority, that means new
citizen-facing services (case tracking, bookings, contacts) can be prototyped
and delivered in hours rather than weeks, with the same authentication model and
the same UX patterns every time. It is the developer-experience layer of the
Contact Portal API pillar.

## Architecture overview

- **`.claude-plugin/marketplace.json`** — the marketplace manifest: name
  (`truenorthit`), owner, and the list of five plugins with their source paths.
  Installed with `claude plugin marketplace add TrueNorthIT/claude-plugins`.
- **`plugins/<name>/.claude-plugin/plugin.json`** — one manifest per plugin
  (name, description, version). Versions are per plugin and move independently;
  the repo itself carries no version.
- **`plugins/<name>/skills/<skill>/SKILL.md`** — the auto-invoked skill, one per
  plugin. The description in its front matter is what makes Claude reach for it,
  so it is written as trigger phrases rather than a summary.
- **`plugins/<name>/skills/<skill>/references/`** — the larger plugins split
  their detail into reference files the skill loads on demand
  (`dataverse-contact-api`: auth, routes, permissions, querying, sdk, admin,
  troubleshooting; `dataverse-terraform`: patterns, provider-reference,
  explaining; `create-gds-service`: GDS rules, schema mapping, templates).
- **`plugins/<name>/hooks/`** — `hooks.json` plus `check-updates.mjs`, a
  `SessionStart` hook per plugin that compares the installed version against
  `plugin.json` on `main` and prompts to update. Silent when current.
- **`plugins/bigmac/.mcp.json`** — the only MCP registration in the repo; the
  Dataverse plugins deliberately need none.

There is no runtime service here — it is configuration and instructions executed
by Claude Code on the developer's machine. External integrations are the
Dataverse Contact API (discovery, admin and data endpoints), Microsoft Entra
External ID (portal authentication config, consumed as IDs — the plugins never
create an app registration), the public Terraform registry
(`TrueNorthIT/dataversecontact`), npm (the `@truenorth-it/contact-admin` CLI and
the `@truenorth-it/dataverse-client` SDK), and the office Ollama server for
`bigmac`.

Distribution is via GitHub: a developer adds the marketplace once, installs the
plugins they want, and updates with
`claude plugin marketplace update truenorthit`. Because that update check keys
off `plugin.json`, **a change to a plugin only reaches installed users if its
version is bumped** — anyone who installed at the old version keeps the old
files until then.
