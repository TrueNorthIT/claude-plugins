# TrueNorth IT — Claude Code Marketplace

Claude Code plugins for building against TrueNorth IT services.

## Available plugins

| Plugin | Description |
|---|---|
| [`dataverse-portal`](./plugins/dataverse-portal) | Scaffold a React + TypeScript + Tailwind + Auth0 SPA against the [Dataverse Contact API](https://api.dataverse-contact.tnapps.co.uk). |

## Install

```bash
# Add this marketplace once
claude plugin marketplace add TrueNorthIT/claude-marketplace

# Install a plugin
claude plugin install dataverse-portal@truenorthit
```

Or from inside a Claude Code session:

```
/plugin marketplace add TrueNorthIT/claude-marketplace
/plugin install dataverse-portal@truenorthit
```

## Update

```bash
claude plugin marketplace update truenorthit
```

## Local development

To iterate on a plugin locally before pushing:

```bash
claude plugin marketplace add ./claude-marketplace
claude plugin install dataverse-portal@truenorthit
```

Changes to plugin files take effect next session. To validate the marketplace manifest and plugin manifests:

```bash
claude plugin validate .
```

## Layout

```
claude-marketplace/
├── .claude-plugin/
│   └── marketplace.json              ← Marketplace manifest (name, owner, plugins[])
├── plugins/
│   └── dataverse-portal/
│       ├── .claude-plugin/
│       │   └── plugin.json           ← Plugin manifest (name, description, version)
│       └── skills/
│           └── build-portal/
│               └── SKILL.md          ← Auto-invoked skill
└── README.md
```
