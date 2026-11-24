# Breaking changes

One entry per Contact API release that can break a working portal or a scope's
configuration, newest first. A release not listed here needs no changes.

Each entry has the same parts:

- **What changed**: the behaviour before and after.
- **Look for**: patterns to search for. A match is a lead, not a finding.
- **Affected when** / **Not affected when**: what turns a match into a finding.
- **Fix**, and **When**: whether the fix can go out before the upgrade or only
  with it.

## 1.56.0: SharePoint document listings are flat

**What changed.** `GET /{tier}/{table}/{id}/documents` (SDK `documents()`, MCP
`list_documents`) returns every file in the record's folder and in all its
sub-folders as one list, the way a blob listing does. Up to 1.55.0 it returned
one folder level, with a row for each sub-folder.

- Files in sub-folders appear without being asked for.
- There are no folder rows. `isFolder` is still on every row and is always
  `false`.
- A document's `folder` is relative to the folder the route serves. On a route
  that sets `documents.folder` to `Public`, a file in `Public/Photos` has
  `folder: "Photos"`, where it had `"Public/Photos"`. A file at the route's top
  level has `folder: ""`.
- A route's own `documents.filters` on `folder` are relative in the same way.
- A filter on `folder` compares whole folders: `startswith Photos` matches
  `Photos` and `Photos/2026`, never `Photos-old`. Case and leading or trailing
  slashes are ignored.
- A listing that reaches a cap (500 documents, 200 sub-folders, 10 levels)
  says so with `page.truncated: true`.

Download links, uploads, upload invites and the `folder=` query parameter (the
SDK's `folder` option), which picks where a listing starts, are unchanged.

### Portal code

**Look for**

- `.documents(` on a tier client (`client.me`, `client.team`, `client.all`)
- `/documents` in a hand-built request URL
- `isFolder`
- `.folder` read from a listed document, and `"folder"` as a filter or
  `orderBy` field
- `list_documents` in an agent or MCP client

**Affected when**

| The portal | After the upgrade |
|---|---|
| Renders folder rows, or lets the person open a folder by clicking one (`isFolder` true, then a second call with `folder`) | No folder rows arrive, so the folders disappear and sub-folder files are listed at the top instead |
| Assumes a listing is one level: a count, a "no documents" message, a heading per folder | Files from every sub-folder are included |
| Filters or sorts on `isFolder` (`isFolder eq true`, folders first) | `isFolder eq true` matches nothing; `eq false` matches everything |
| Compares a document's `folder` with a path that includes the route's own folder (`doc.folder === "Public/Photos"`, a filter with that value) | `folder` no longer has the prefix, so the comparison never matches |
| Builds a path from `folder` to pass on (to an upload, to a display breadcrumb) by stripping the route's folder off the front | The prefix isn't there to strip |
| Relied on `startswith` matching part of a folder name (`startswith Pho`) | It matches whole folders only |
| Reads every page to build a complete list | Check `page.truncated`: a large folder tree is cut off at the caps |

**Not affected when**

- The portal only shows what it is given, as a plain list of files, and the
  record's folders have no sub-folders that matter.
- It only uploads or requests download links.
- `folder` is passed as the listing's start (`documents(table, id, { folder })`)
  and never compared: that is unchanged.

**Fix**

- A folder browser: list once and group the rows by `folder`, or ask for one
  level with a filter. The top level is
  `{ field: "folder", operator: "eq", value: "null" }`; one folder is
  `eq "Photos/2026"`; a folder and everything under it is
  `startswith "Photos"`.
- A list that should stay one level: add the `eq` filter above.
- Drop filters and sorting on `isFolder`.
- Comparisons with `folder`: remove the route's own folder from the value.
- Show something when `page.truncated` is true, and offer a narrower view.

**When.** Ignoring folder rows and grouping what arrives by `folder` works on
both versions, so it can go out first (before the upgrade it shows one level).
The `eq "null"` filter matches nothing before 1.56.0, and a comparison with a
`folder` value on a route that sets `documents.folder` gives different answers
on the two versions, so those changes go out with the upgrade.

### Scope configuration

**Look for**, in Terraform or route JSON, on any route with a `documents`
block:

- `folder` in the documents settings (the folder the route serves)
- `filters` in the documents settings that name `folder` or `isFolder`

**Affected when**

| The route | After the upgrade |
|---|---|
| Sets `documents.folder` and has a filter on `folder` that includes it (`folder startswith Public/Photos` on a route serving `Public`) | The filter matches nothing, so the route lists no documents |
| Has a filter `isFolder eq false` | Harmless, and no longer needed |
| Has a filter `isFolder eq true`, or one that kept folder rows visible | Matches nothing |
| Was meant to expose only the files at the top of the record's folder, and relied on the listing being one level | Files in sub-folders are now listed and can be downloaded through the list. A download link for a file in a sub-folder could already be requested by its id, so this is wider listing, not new access |
| Has a filter on a declared column to hide documents (`IsPublic eq true`) | Unchanged: it applies to every file at any depth |

**Fix**

- Remove the route's own folder from `folder` filters
  (`folder startswith Photos`).
- To keep a route to its top level, add `folder eq null` to
  `documents.filters`.
- Remove `isFolder` filters.

**When.** With the upgrade. A `folder` filter that includes the route's folder
is only right before 1.56.0, and `folder eq null` matches nothing before
1.56.0 (empty text didn't count as no value), so applying either early hides
every document. Removing an `isFolder eq false` filter can wait until after.

## 1.26.0: reserved route names

**What changed.** A table route can no longer be named after a segment the
router reads after a tier: `actions`, `lookup`, `aggregate`, `changes`. Saving
such a route is refused. A route saved earlier and never saved again keeps
working, which is why a fresh environment can fail on configuration that a
long-lived one accepts.

**Look for**, in the scope's configuration: a route name or alias equal to one
of the four names.

**Affected when** the configuration is applied to a new environment, or the
route is saved again.

**Fix.** Rename the route or alias, and update the portal's calls to the new
name. **When:** before the upgrade.
