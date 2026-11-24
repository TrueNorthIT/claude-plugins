---
name: check-upgrade
description: Check a portal and its scope configuration against the breaking changes between two versions of the Dataverse Contact API, before the API is upgraded, and report each place that needs changing with file:line and the fix. Covers portal code that uses @truenorth-it/dataverse-client or calls the API with fetch, and the scope's route configuration in Terraform or JSON (for 1.56.0 — SharePoint document listings that relied on folder rows or one level at a time, isFolder, filters on a document's folder, routes that set documents.folder). Use when the user asks whether it is safe to upgrade the Contact API or its Docker image, what a new API version breaks for them, to check a portal against a release or its release notes, "we're moving from 1.55 to 1.56, what do we need to change", "will this release break my portal", or to prepare a portal for an upgrade. Report-only unless the user asks for fixes.
---

# check-upgrade

Most Contact API releases change nothing for a portal that already works. A few
change what a response contains or what configuration is accepted, and those
are listed, one entry per release, in `references/breaking-changes.md`. This
skill finds which of them fall between the version a portal runs against and
the version it is moving to, looks for the code and configuration each one
affects, and reports what to change. It is report-only until the user asks for
changes.

It needs no credentials and no network. Don't ask for any.

## 1. Establish the two versions

- **From:** the API version the portal runs against today. In order of
  preference: what the user says; the Docker image tag their deployment runs
  (`vX.Y.Z`, in their infrastructure code); `GET <api>/version` on a container
  deployment (public; the hosted API doesn't serve it). The installed
  `@truenorth-it/dataverse-client` version is a fallback: the SDK and the API
  share version numbers, but a portal's SDK is often older than its API, so
  say that it's a guess.
- **To:** the version they are upgrading to. If they don't say, use the newest
  entry in `references/breaking-changes.md` and say so.

If you can't establish **from**, check every entry and say that you did.

The hosted API (`https://api.dataverse-contact.tnapps.co.uk`) runs the newest
version as soon as it is merged, ahead of the Docker image. A portal on it has
no "before": check it against the newest entry.

## 2. Find what is under review

- **The portal:** the `package.json` that depends on
  `@truenorth-it/dataverse-client`, or source that calls `/api/v2/`. Several
  portals in one repo are each checked.
- **The scope's configuration:** Terraform using the `dataversecontact`
  provider (`dataversecontact_table` and friends), or the route JSON it is
  generated from. It is often in another repo: if it isn't here, ask where it
  is once, and carry on with the portal if the user doesn't have it. Say in
  the report that the configuration wasn't checked.
- **MCP clients and agents** that call the API's tools count as clients too.

## 3. Check each entry in range

Take every entry in `references/breaking-changes.md` with a version above
**from** and up to **to**. For each one:

1. Search for its **Look for** patterns, in the portal and in the
   configuration. A pattern match is a lead, not a finding.
2. Open each match and apply the entry's **Affected when** and **Not affected
   when**. Read enough of the surrounding code to know what the portal does
   with the value: a listing that is only counted is different from one that
   renders a folder browser.
3. Where nothing matches, say the entry was checked and nothing was found.
   That is a result the user needs, not an omission.

Don't run the portal, call the API with the user's credentials, or read `.env`
files to do this. If a check needs to know how a route is configured and the
configuration isn't available, the scope's public schema
(`GET <api>/api/v2/<scope>/schema`) says which routes have documents, and no
more than that.

## 4. Report

Lead with the answer: safe to upgrade as it is, or the number of changes
needed first. Then one section per release that affects them:

- **What changed**, in one or two sentences.
- **Findings**, each with `file:line`, what the code does today, what it will
  do after the upgrade, and the fix from the entry.
- **Checked, nothing found**, for entries that didn't apply.

Then anything you couldn't check (configuration in another repo, a portal that
builds its requests in a way you couldn't trace) and what the user should look
at by hand.

Keep changes that must go out **before** the upgrade apart from ones that can
only go out **with** it. Each entry says which it is. Where a fix can't work on
both versions, say so: the portal and the API then have to change together.

## 5. If asked to fix

Make the changes the entries describe, and nothing else. Run the portal's own
`typecheck` and tests afterwards and report the result with the output. For a
configuration change, prepare it for the user's normal change process
(`terraform plan`, a pull request); don't apply it.

## Keeping the list current

`references/breaking-changes.md` is the whole of what this skill knows. A
release of the API that changes a response, refuses configuration that used to
save, or removes something gets an entry there, in the same change as its
release notes. A deprecation gets one when the old behaviour is removed, not
when it is deprecated.
