# claude-plugins (TrueNorth IT Claude Code Marketplace)

## What it does — user, customer & business value

This repository is TrueNorth IT's Claude Code plugin marketplace: a catalogue of AI-assisted developer tooling for building against TrueNorth services. Today it ships one plugin, **dataverse-portal**, whose `build-portal` skill turns a single natural-language prompt (e.g. "build me a case portal" or "scaffold a UI for the booking table in scope pilot") into a complete, working citizen-facing web portal — a React + TypeScript + Tailwind + Auth0 single-page app wired to the Dataverse Contact API.

The users are developers (in-house, partner, or council) using Claude Code. The problem it solves is the cost and inconsistency of hand-building portal frontends for each local authority service: the skill automates API discovery, authentication via the `@truenorth-it/contact-admin` CLI, scope provisioning, table publishing, and frontend scaffolding, following the proven patterns from the example case portal. For a local authority, this means new citizen-facing services (case tracking, bookings, contacts) can be prototyped and delivered in hours rather than weeks, with consistent security (Auth0) and consistent UX patterns. It is the developer-experience layer of the Contact Portal API pillar.

## Architecture overview

- **`.claude-plugin/marketplace.json`** — marketplace manifest (name `truenorthit`, owner, plugin list). Installed with `claude plugin marketplace add TrueNorthIT/claude-plugins`.
- **`plugins/dataverse-portal/.claude-plugin/plugin.json`** — plugin manifest (name, description, version; currently 0.10.0).
- **`plugins/dataverse-portal/skills/build-portal/SKILL.md`** — the auto-invoked skill. A step-by-step playbook that:
  1. Parses the prompt for API URL, scope, access tier (`me`/`team`/`all`), target table, and project name.
  2. Discovers the deployment via the API's `/.well-known/oauth-protected-resource` (Auth0 domain/audience) and `contact-admin scopes list`.
  3. Authenticates and provisions scopes/tables through the `@truenorth-it/contact-admin` CLI (no MCP registration needed).
  4. Scaffolds a Vite + React + TypeScript + Tailwind + Auth0 SPA against the published API routes.
- **`plugins/dataverse-portal/hooks/`** — `hooks.json` + `check-updates.mjs`, a session hook that checks for newer plugin versions; the skill itself also enforces a version match before running.

There is no runtime service in this repo — it is configuration and instructions executed by Claude Code on the developer's machine. External integrations are the Dataverse Contact API (discovery, admin, data endpoints), Auth0 (portal authentication config), and npm (the `contact-admin` CLI). Distribution is via GitHub: developers add the marketplace once, install the plugin, and update with `claude plugin marketplace update truenorthit`.
