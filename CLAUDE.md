# CLAUDE.md

TrueNorth IT's Claude Code plugin marketplace (`truenorthit`). One repo, many
plugins, each installed, versioned and updated on its own. There is no runtime
service here: everything is skills, hooks and manifests that Claude Code runs on
the developer's machine. `README.md` lists the plugins; `OVERVIEW.md` explains
the layout.

## Layout

- `.claude-plugin/marketplace.json`: the marketplace manifest (name, owner, and
  each plugin's `name`, `source` and `description`).
- `plugins/<name>/.claude-plugin/plugin.json`: one manifest per plugin. Its
  `version` is the only place a plugin's version lives.
- `plugins/<name>/skills/<skill>/SKILL.md`: auto-invoked skills. The front-matter
  `description` is what makes Claude reach for one, so write it as triggers.
  Keep SKILL.md under about 500 lines, with detail in `references/<topic>.md`
  that the skill names at the step that needs it.
- `plugins/<name>/hooks/`: a `SessionStart` update check that compares the
  installed version with `plugin.json` on `main`.

## Versioning and publishing

- Publishing is merging to `main`: users get it with
  `claude plugin marketplace update truenorthit`.
- **Bump `version` in the plugin's `plugin.json` with every change to it**, or
  installed users never see the change. Minor for a new skill, command or
  behaviour; patch for a fix or wording. Versions move per plugin; the repo has
  none.
- A skill that checks its own plugin version (build-portal's "Expected plugin
  version") moves with the bump.
- Validate before a PR: `claude plugin validate .` (marketplace and every plugin).

## The Contact Portal API plugins

Work on the plugins that sit on the Contact Portal API (CPA), namely
`dataverse-portal`, `dataverse-contact-api` and `dataverse-terraform`, is
checked with the `persona-check` skill (in `dataverse-contact-api`) against the
CPA personas, before planning and again before the PR. The personas live in the
CPA repo (`TrueNorthIT/dataverse-contact-api`, `personas/`); never copy their
rules into this repo.
