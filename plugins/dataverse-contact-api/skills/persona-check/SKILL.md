---
name: persona-check
description: Check a request for work on the Contact Portal API (CPA) or the repos around it against the CPA's personas (product owner, React developer, Dataverse back office, security, platform engineer, LA Stack, client portal) before planning it, and again before opening the PR. Use whenever the user asks to add, build, change, design or plan anything in a CPA sibling repo - a Terraform provider attribute or resource, a Table Manager screen, a Claude plugin skill, onboarding docs or scripts, a portal feature that needs a new API capability, an SDK method, a CLI command, a config option - even a small one, and even if they don't mention personas. Also use when asked whether such a change is right, what else it needs, or what a persona would say.
---

# Persona check

Every piece of work on the Contact Portal API (CPA) and the repos around it is
checked against the roles the CPA serves, so a change that suits one of them
doesn't quietly break another's. The siblings this covers include the Terraform
provider (terraform-provider-dataversecontact), the Table Manager, the
onboarding repo, these Claude plugins, and portals built on the CPA.

**The source of truth is the CPA repo's `personas/` folder** (and the
"Deliberate non-goals" section of its `PRODUCT.md`). This plugin never copies
the rules into itself: read them fresh every time, so a rule changed in the CPA
repo applies here the same day.

## 0. Get the personas

- **In the CPA repo** (the current repo has `personas/README.md` at its root):
  read the local `personas/` files and `PRODUCT.md`.
- **Anywhere else:** fetch them from GitHub, `develop` branch:

  ```bash
  # List the persona files
  gh api "repos/TrueNorthIT/dataverse-contact-api/contents/personas?ref=develop" \
    --jq '.[] | select(.type == "file") | .name'

  # Each file's content, base64-decoded (README.md first, then every persona)
  gh api "repos/TrueNorthIT/dataverse-contact-api/contents/personas/<name>?ref=develop" \
    --jq .content | base64 -d

  # PRODUCT.md, for its "Deliberate non-goals" section (up to the next "## ")
  gh api "repos/TrueNorthIT/dataverse-contact-api/contents/PRODUCT.md?ref=develop" \
    --jq .content | base64 -d
  ```

  `-H "Accept: application/vnd.github.raw"` in place of `--jq .content | base64 -d`
  returns the same text undecoded, if `base64` isn't available.
- **If neither works** (no local copy, and `gh` isn't signed in or can't reach
  the repo), say so and stop. Don't guess the rules from memory or from this
  file.

## Before planning

1. Read `personas/README.md`, then every persona file. They're short; read them all, not just
   the ones that look relevant: the point is to catch the one you didn't think of. Then read
   "Deliberate non-goals" in `PRODUCT.md`: a request that crosses one is red, whatever the
   personas say (#586, per-field labels on invites, was a forms builder by another name).
2. For each persona, decide what it says about this request:
   - **Green:** fits its rules. Note any work its rules add (see below).
   - **Amber:** needs a decision: a rule would bend, or it's a breaking change, or nothing
     traces to a persona. The product owner decides; that's the user unless they say otherwise.
   - **Red:** breaks a rule. Quote the rule, and offer the version of the request that keeps it.
3. Collect the **follow-on work** the rules require. Paths are in the CPA repo unless they
   name another; work in a repo other than the current one becomes an issue there. Typical ones:
   - React developer: SDK method and types, OpenAPI, `/schema`, `docs/API.md`, `sdk/README.md`,
     the plugin skills (claude-plugins repo); a major version if it breaks anything.
   - Product owner: no new setup step for a portal team (a default, or automated in Terraform
     or the solution import), runs in the Docker image with configuration only, MCP tool with
     the same checks, E2E test, version bump, docs.
   - Platform engineer: provider attribute (terraform-provider-dataversecontact), no drift on
     admin reads, warning-first for new refusals, env var documented in `docker/README.md` and
     the onboarding repo.
   - Security: audit seam (`AuditContext`, `recordRead`), server-side scoping on every surface,
     nothing secret in logs or URLs.
   - Dataverse back office: solution version bump and upgrade check, plain wording with (i).

   A change in a sibling repo often needs the CPA to move first (a provider attribute for a
   setting the API doesn't have yet, a portal screen for an endpoint that doesn't exist). Name
   that as follow-on work in the CPA repo, not something to work around in the sibling.
4. Report it to the user **before** writing code, in this shape, and keep it short:

   | Persona | Says | Why (rule) |
   |---|---|---|
   | Platform engineer | Red | Rule 1: a CLI can't add a concept the provider lacks |
   | React developer | Green, adds work | Rule 1: SDK method + types |

   Then the follow-on work as a checklist, then any amber questions. Leave out personas with
   nothing to say. If everything is green with no follow-on work, say so in one line and go on.
5. Wait for answers on amber and red before building. Put the follow-on work in the plan or todo
   list, so it isn't forgotten. Work in progress is fine (for example "SDK method in a follow-up
   PR, issue raised"); silently dropping an item isn't.

## Before the PR

Go through the follow-on list again. Each item is done, or deferred with a reason the user
agreed to (and an issue for it where it's in another repo). Say which in the PR description.

## When a persona is wrong

If the work shows a rule is out of date or missing, propose the edit to the persona file and
let the user approve it. The edit goes in the CPA repo's `personas/`, never in this plugin.
Never edit a persona just to make a change fit.

## Example

Request: "Let's have a CLI to add a table."

| Persona | Says | Why |
|---|---|---|
| Platform engineer | Amber | Rule 1: tables are `dataversecontact_table` in Terraform. A CLI may drive the same admin API, but anything it can set must exist in the provider, and the CLI shouldn't become a second way of keeping config. `admin-cli` and `npm run add-table` already exist. |
| React developer | Green | No API change, nothing for the SDK. |

Question for the product owner: what is the CLI for that Terraform doesn't cover (a quick
start, generating the Terraform for a table)? Generating `.tf` would keep rule 1 whole.
