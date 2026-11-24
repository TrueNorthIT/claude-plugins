# Code quality — the scaffolded code must teach

_Part of the `build-portal` skill. Read it at step 7, before writing services, hooks and components. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

The generated code is the developer's first contact with the SDK and the API. Every file should make them feel like they already know how to extend it. This means:

**Comment every SDK call** — not what it does (they can read code), but *why* this pattern and *what else they could do*. Match the query syntax in these examples exactly — `orderBy` and `filter` are objects, not strings:

```ts
// Fetch cases for the logged-in user. client.me automatically scopes
// queries to records linked to the authenticated contact.
// Switch to client.team for account-wide access, or client.all for admin.
// QueryOptionsFor<CaseField> checks every field name against the generated
// schema, so a typo fails `npm run typecheck` instead of returning a 400.
const options: QueryOptionsFor<CaseField> = {
  select: ["incidentid", "ticketnumber", "title", "statuscode"],
  orderBy: { field: "modifiedon", direction: "desc" },
  top: 50,
  // Add filters like this. Choice values come from the generated consts,
  // not magic numbers:
  // filter: { field: "statuscode", operator: "eq", value: CaseStatuscode.InProgress },
  //
  // Or combine multiple — an ARRAY of conditions plus filterLogic.
  // There is no { and: [...] } wrapper:
  // filter: [
  //   { field: "prioritycode", operator: "eq", value: CasePrioritycode.High },
  //   { field: "statecode", operator: "eq", value: CaseStatecode.Active },
  // ],
  // filterLogic: "and",   // "and" is the default; "or" is the alternative
};
const cases = await client.me.list<Case>("case", options);
```

**Show the next move in comments** — every service function should hint at what the developer will want to do next:

```ts
export async function createCase(client: DataverseClient, input: CaseCreateInput) {
  // Creates a case auto-bound to the caller's contact (via createDefaults
  // in the table schema). That is why CaseCreateInput has no customerid:
  // the generator leaves auto-bound and read-only columns out.
  //
  // To attach a note after creating:
  //   await createCaseNote(client, { incidentid: result.incidentid, notetext: "..." });
  return client.me.create<Case>("case", input);
}
```

**Include working examples in hook files** — show loading, error, empty states, refresh and paging. Every hook is TanStack Query; `useState` + `useEffect` fetching is not an option here, and a mutation invalidates rather than hand-patching the cache. A list hook is `useInfiniteQuery`, because the API never returns more than 100 rows at a time:

```ts
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useCases() {
  const client = useDataverseClient();
  const query = useInfiniteQuery({
    // The key is the cache identity AND what mutations invalidate. Keep the
    // table name first and the view second, so ['case'] invalidates every view.
    queryKey: ["case", "list"],
    // ApiError carries .status and .message straight from the API response,
    // so the component can branch on 404 (no contact) vs 403 (no permission).
    //
    // The first page comes from list(); every later one from fetchPage() with
    // the page.next URL the API returned. That URL keeps the cursor, select,
    // filter and orderBy, so never rebuild it or count rows with skip.
    queryFn: ({ pageParam }) =>
      pageParam ? fetchCasesPage(client, pageParam) : fetchCases(client),
    initialPageParam: null as string | null,
    // page.next is null on the last page, which ends the paging.
    getNextPageParam: (last) => last.page.next ?? null,
  });

  return {
    cases: query.data?.pages.flatMap((p) => p.data) ?? [],
    // Drive a "Load more" button with these.
    hasMore: query.hasNextPage,
    loadMore: query.fetchNextPage,
    isLoadingMore: query.isFetchingNextPage,
    // `isSuccess`, not `!isLoading && !error` — see the QueryClient note in references/auth.md. Only
    // isSuccess means the API answered, and only then is an empty list true.
    isSuccess: query.isSuccess,
    isPending: query.isPending,
    // Background refetch of data already on screen — show a subtle indicator,
    // not the loading skeleton.
    isRefreshing: query.isFetching && !query.isPending && !query.isFetchingNextPage,
    error: query.error,
    refresh: query.refetch,
  };
}

// Writes go through useMutation. Invalidate on success rather than seeding the
// cache from the response: create and PATCH responses come back with no expand,
// so writing one into an expanded record's cache entry blanks the joined names.
export function useCreateCase() {
  const client = useDataverseClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CaseCreateInput) => createCase(client, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["case"] });
    },
  });
}
```

**Forms follow the write rules.** From API 1.58.0 a route can hold a field to
`fixed`, `default`, `allowed`, `required`, `minLength`/`maxLength` and
`min`/`max`. The server enforces them; the form's job is to make a refusal
rare and readable. The generated types already carry them: a `fixed` field is
missing from `CaseCreateInput` (the API writes it), an `allowed` field is a
union (`casetypecode?: 1 | 2`), and a `required` field with no default is
non-optional. Build the form from that, and from `/schema` for the lengths:

```tsx
// casetypecode is `1 | 2` in CaseCreateInput: the scope allows only Question
// and Problem, so offer only those. caseorigincode isn't in the input at all —
// the API writes it on every create (a `fixed` rule) — so there's no field for it.
<select id="casetypecode" value={form.casetypecode ?? 1} onChange={(e) => set("casetypecode", Number(e.target.value) as 1 | 2)}>
  <option value={CaseCasetypecode.Question}>Question</option>
  <option value={CaseCasetypecode.Problem}>Problem</option>
</select>

// title is required with maxLength 200 in /schema: say so in the input, so the
// browser catches it before the API has to.
<input id="title" required maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} />
```

When the API still refuses (another tab changed the rules, or a value the form
couldn't check), it answers 400 `validation_failed` with one entry per field.
Show each next to its field with `fieldErrors` (`references/code-security.md`):

```ts
const create = useCreateCase();
// …
create.mutate(input, {
  onError: (err) => setErrors(fieldErrors(err)), // { title: "Enter a title.", … }
});
```

Never make the form the only place a rule lives. A dropdown that hides an
option or a hidden input that always sends a value is UX; if the value must
hold, it's a write rule in the scope (Terraform), and a portal without it is a
finding in `review-portal`.

**Components should be a starting point, not a dead end.** Include TODO comments that map out the obvious next features:

```tsx
// TODO: Let the citizen edit the description — a useMutation calling
//       updateCase(client, id, { description }), invalidating ['case'] on
//       success. Status and priority are readOnly in the schema: staff change
//       those, and the API silently drops them from a citizen's PATCH.
//
// TODO: Add search — use the filter option:
//       filter: { field: "title", operator: "contains", value: searchTerm }
```

**Types are generated, so document them where they are used.** `dataverse.generated.ts` already carries each column's display name and choice values as JSDoc, so hovering a field in the editor shows them. Do not add a `types/` folder that restates it. Put the explanation in the service and component comments, where it says why this screen picks these columns:

```ts
import type { Case } from "../dataverse.generated";

// The list only needs these four columns. Pick from the generated row type
// rather than declaring a second interface that drifts from the schema.
// statuscode_label comes back with every choice column, already translated.
export type CaseRow = Pick<Case, "incidentid" | "ticketnumber" | "title" | "statuscode_label">;

// An expand adds a nested object the generated row type doesn't describe.
// Extend the row type for that call only:
export type CaseWithContact = Case & {
  customerid_contact?: { fullname?: string; emailaddress1?: string };
};
```

The goal: a developer reads the generated code for 10 minutes and thinks "I know exactly how to add the next feature."
