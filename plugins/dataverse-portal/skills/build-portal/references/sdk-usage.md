# SDK usage — the only acceptable pattern

_Part of the `build-portal` skill. Read it at step 7, before writing `src/lib/client.ts` and any `services/*Api.ts`. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

```ts
// src/lib/client.ts — one client, memoised on getToken so hook deps stay stable.
import { createClient, type DataverseClient } from "@truenorth-it/dataverse-client";
import { useMemo } from "react";
import { API_BASE_URL, API_SCOPE } from "../env";
import { useAuth } from "../auth";

export function useDataverseClient(): DataverseClient {
  // getToken comes from AuthProvider — it wraps acquireTokenSilent and
  // escalates to a redirect when the IdP needs to see the user. Nothing here
  // touches MSAL directly, so swapping the IdP is a one-file change.
  const { getToken } = useAuth();
  return useMemo(
    () => createClient({ baseUrl: API_BASE_URL, scope: API_SCOPE, getToken }),
    [getToken],
  );
}

// src/services/caseApi.ts — read
import type { DataverseClient, QueryOptionsFor } from "@truenorth-it/dataverse-client";
import type {
  Case,
  CaseField,
  CaseCreateInput,
  CaseUpdateInput,
  Casenotes,
  CasenotesField,
} from "../dataverse.generated";

// Typed options: "titel" here is a compile error, not a runtime 400.
// top is the page size: 20 if left out, and 100 at most (more is cut to 100
// without an error). It is never "all rows" — useCases pages through the rest.
const CASE_LIST: QueryOptionsFor<CaseField> = {
  select: ["incidentid", "ticketnumber", "title", "statuscode"],
  orderBy: { field: "modifiedon", direction: "desc" },
  top: 50,
};

// The first page.
export async function fetchCases(client: DataverseClient) {
  return client.me.list<Case>("case", CASE_LIST);
}

// Every later page. `next` must be the page.next the API returned: fetchPage
// sends the token with it, and refuses a URL off the API's origin.
export async function fetchCasesPage(client: DataverseClient, next: string) {
  return client.me.fetchPage<Case>(next);
}

// Every row, for a bounded set only (an export, a short dropdown). eachPage
// follows page.next until it runs out. Don't use it to fill a list screen.
export async function fetchAllCases(client: DataverseClient) {
  const rows: Case[] = [];
  for await (const page of client.me.eachPage<Case>("case", CASE_LIST)) {
    rows.push(...page.data);
  }
  return rows;
}

export async function fetchCase(client: DataverseClient, id: string) {
  return client.me.get<Case>("case", id);
}

// src/services/casenoteApi.ts — fetch notes for a case
export async function fetchCaseNotes(client: DataverseClient, caseId: string) {
  const options: QueryOptionsFor<CasenotesField> = {
    filter: { field: "incidentid", operator: "eq", value: caseId },
    orderBy: { field: "createdon", direction: "desc" },
  };
  return client.me.list<Casenotes>("casenotes", options);
}

// src/services/fileApi.ts — download a note's attachment (or an email's).
// Ask for the link on click and navigate at once: it expires in minutes, so it
// never goes in a query cache. The browser downloads it from storage as an
// attachment; nothing is fetched into the page.
export async function downloadFile(client: DataverseClient, table: string, id: string, fileId: string) {
  const link = await client.me.fileLink(table, id, fileId);
  window.location.assign(link.url);
}

// src/services/caseApi.ts — write. CreateInput/UpdateInput hold only the
// writable columns, so setting statuscode or customerid fails to compile.
export async function createCase(client: DataverseClient, input: CaseCreateInput) {
  return client.me.create<Case>("case", input);
}

export async function updateCase(
  client: DataverseClient,
  id: string,
  patch: CaseUpdateInput,
) {
  return client.me.update<Case>("case", id, patch);
}
```

Tier selection follows the user's `TIER` from the prompt:
- `me` → `client.me.list/get/create/update` — caller's records only (needs `contactJoinPath`)
- `team` → `client.team.*` — account-linked records (needs `teamJoinPath`)
- `all` → `client.all.*` — admin-tier, unfiltered

`client.me` is the only tier with `create`. There is no DELETE on the data tier at all.

**Custom APIs: call them on the portal's tier — `client.me.invokeFunction` / `invokeAction`** (SDK 1.26.0 and later; `team` likewise). They call `/{tier}/actions/{name}[/{recordId}]` with the citizen's token and selected company, and the API checks the tier's `:invoke` permission and that the record is the citizen's. **The record goes in `recordId`, never in the body** — the API checks the record in the URL and writes it into its own parameter itself; a body naming a different record is a 400. A caller-scoped API ("my bookings") takes no `recordId`: the API fills in who's asking. `client.public.invokeFunction` / `invokeAction` send no token, so they only reach APIs published on the `public` tier. A 404 `not available on the me tier` means the scope hasn't published the API there — ask for that, never for the API to be made public:

```ts
// An action (POST) on the citizen's own case — the case in recordId,
// parameters in the JSON body.
await client.me.invokeAction("close-incident", {
  recordId: caseId,
  body: { IncidentResolution: { subject: "Resolved online" }, Status: 5 },
});

// A caller-scoped function (GET) — no recordId; parameters in the query string.
const { data } = await client.me.invokeFunction<{ Bookings: string }>("my-upcoming-bookings");

// Anonymous, read-only data on the public tier.
const slots = await client.public.invokeFunction<{ result: Slot[] }>("expand-calendar", {
  recordId: calendarId,
  params: { Start: start, End: end },
});
```

Two things the API's definition can do that change what the portal sends (read them off `openapi.json` for the action, not off the Dataverse API's own parameter list):

- **`recordId` may be a reference number** (API 1.29.0+). If the definition's target has `recordKey` (e.g. `ticketnumber`), pass the case reference the citizen sees, `recordId: "CAS-01234-X1Y2"`, or the GUID. The server finds the case, checks it's theirs and writes the right value into the API.
- **Fixed parameters aren't the portal's to send** (API 1.30.0+). A parameter in the definition's `fixedParameters` (a staff-only flag such as `IsPrivate`) is always sent by the server and anything the portal sends is overwritten, so leave it out of `body` / `params`. It doesn't appear in the action's request schema. A parameter with a `default` may be left out too. Never add a UI control for a fixed parameter.

For picklist labels, the SDK automatically includes `<field>_label` alongside `<field>` in list responses when the schema declares the field as `choice`. Use those fields directly in the UI — no extra lookup needed.

For filters:
```ts
// Single-field filter. Choice values come from the generated consts:
// CaseStatuscode.InProgress, not 1.
const active = await client.me.list<Case>("case", {
  filter: { field: "statuscode", operator: "eq", value: CaseStatuscode.InProgress },
});

// Composite filter — an array, combined by `filterLogic`.
// `QueryOptions.filter` is `FilterCondition | FilterCondition[]`; there is no
// `{ and: [...] }` shape, and passing one type-errors.
const urgent = await client.me.list<Case>("case", {
  filter: [
    { field: "prioritycode", operator: "eq", value: CasePrioritycode.High },
    { field: "statecode", operator: "eq", value: CaseStatecode.Active },
  ],
  filterLogic: "and",   // default; use "or" for the alternative
});
```

Never construct OData strings by hand. The SDK builds `$filter` from the structured object.
