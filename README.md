# TrueNorth IT — Claude Code Marketplace

Claude Code plugins for building against TrueNorth IT services.

## Available plugins

Each plugin is independent — install only the ones you want.

| Plugin | Description | Install |
|---|---|---|
| [`dataverse-contact-api`](./plugins/dataverse-contact-api) | How the [Dataverse Contact API](https://api.dataverse-contact.tnapps.co.uk) works — tiers, the permission grammar, the query dialect, Entra auth, the SDK, and 401/403/404 triage. The shared reference the two below assume. | `claude plugin install dataverse-contact-api@truenorthit` |
| [`dataverse-portal`](./plugins/dataverse-portal) | Scaffold a React + TypeScript + Tailwind SPA that signs citizens in with Microsoft Entra External ID (MSAL) and consumes the Contact API. | `claude plugin install dataverse-portal@truenorthit` |
| [`dataverse-terraform`](./plugins/dataverse-terraform/README.md) | Define a Contact API portal backend as Terraform — export an existing scope into HCL and adopt it into state, scaffold and provision a new one, or read a config back in plain English. | `claude plugin install dataverse-terraform@truenorthit` |
| [`create-gds-service`](./plugins/create-gds-service) | Scaffold or remove a GOV.UK Design System service in a service-builder-flow repo. | `claude plugin install create-gds-service@truenorthit` |
| [`bigmac`](./plugins/bigmac) | Offload grunt work (summaries, first-pass exploration, bulk classification) to the office Ollama server. | `claude plugin install bigmac@truenorthit` |

## Install

Add the marketplace once, then install whichever plugins you need:

```bash
claude plugin marketplace add TrueNorthIT/claude-plugins

claude plugin install dataverse-terraform@truenorthit
```

Or from inside a Claude Code session:

```
/plugin marketplace add TrueNorthIT/claude-plugins
/plugin install dataverse-terraform@truenorthit
```

Installing the marketplace does **not** install any plugins — you pick them one
at a time, and each carries its own version and update check.

For what a plugin needs and how to drive it:
[`dataverse-terraform`](./plugins/dataverse-terraform/README.md) and
[`dataverse-contact-api`](./plugins/dataverse-contact-api/README.md) have usage
guides. The others are documented by their skill file — e.g.
[`build-portal/SKILL.md`](./plugins/dataverse-portal/skills/build-portal/SKILL.md).

Building a portal end to end usually means all three of the Dataverse plugins:
`dataverse-contact-api` for what the API does, `dataverse-terraform` to publish
the scope, `dataverse-portal` to scaffold the app against it.

## Update

```bash
claude plugin marketplace update truenorthit
```

## Local development

To iterate on a plugin locally before pushing:

```bash
claude plugin marketplace add ./claude-plugins
claude plugin install dataverse-portal@truenorthit
```

Changes to plugin files take effect next session. To validate the marketplace manifest and plugin manifests:

```bash
claude plugin validate .
```

## Layout

One repo, one marketplace, many plugins — the layout the plugin system is built
for. Each plugin is versioned, installed and updated on its own; the repo is
just where they live.

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json              ← Marketplace manifest (name, owner, plugins[])
├── plugins/
│   ├── dataverse-portal/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json           ← Plugin manifest (name, description, version)
│   │   ├── hooks/                    ← Session-start update check
│   │   └── skills/
│   │       └── build-portal/
│   │           └── SKILL.md          ← Auto-invoked skill
│   ├── dataverse-terraform/
│   ├── create-gds-service/
│   └── bigmac/
└── README.md
```

When changing a plugin, bump the `version` in its `plugin.json` — each plugin's
session-start hook compares the installed version against the one on `main` and
prompts the user to update.
