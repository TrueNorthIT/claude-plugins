# Step 7 — scaffolding the app

_Part of the `build-portal` skill. Read it at step 7, before running `npm create vite`. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

## The house stack

Scaffold this unless the user asks for something else. It is what the existing
portals run, so a developer moving between them meets the same shapes:

| | | |
|---|---|---|
| **React** | 19 | |
| **Vite** | latest | build and dev server; no dev proxy — the API is CORS-enabled |
| **TypeScript** | strict | |
| **TanStack Query** | v5 | **all server state.** No `useEffect` fetching, no SWR, no Redux |
| **MSAL** | v5, latest | `msal-browser` + `msal-react`, majors matched — Entra External ID sign-in |
| **`@truenorth-it/dataverse-client`** | **latest**, never below 1.25.0 | every API call, plus the generated types |
| **React Router** | 7 | |
| **Tailwind** | v4, via `@tailwindcss/vite` | |
| **DOMPurify** | latest | **only** if the portal renders HTML from Dataverse — knowledge articles, email bodies. See `references/code-security.md` |
| **Node** | >= 20 | |

Forms are plain `useState` controlled components. Do not reach for
`react-hook-form` or `zod` — the existing portals declare them and use neither.

From the user's cwd, scaffold into a new subdirectory. **Do not create temp folders, scaffold elsewhere then copy, or go up a directory.** Just run Vite directly:

```bash
PROJECT_NAME=<inferred or from prompt>
npm create vite@latest "$PROJECT_NAME" -- --template react-ts
cd "$PROJECT_NAME"
npm install
npm install @azure/msal-browser@^5 @azure/msal-react@^5 react-router-dom \
  @tanstack/react-query @truenorth-it/dataverse-client@latest
npm install -D tailwindcss @tailwindcss/vite

# The react-ts template ships no `typecheck` script — `npm run build` is the only
# thing that runs tsc, and it also bundles. Add the standalone gate, because
# step 9 depends on it to catch bad SDK query shapes before the user does.
npm pkg set scripts.typecheck="tsc --noEmit"

# Types come from the scope's live schema, never from hand-typed interfaces.
# generate reads the public /schema and /choices endpoints (no token needed).
npm pkg set scripts.generate:types="dataverse-client generate --url ${API_URL} --scope ${TARGET_SCOPE} --output src/dataverse.generated.ts"
npm run generate:types
```

**Say which SDK version you installed** (`npm ls @truenorth-it/dataverse-client`). If it is below 1.25.0, the registry served something stale. Stop and fix that before writing code: the examples in `references/sdk-usage.md` pass generated `CreateInput` types straight to `create`, which needs 1.25.0.

**The generated file is the portal's type layer.** For every table in the scope, `src/dataverse.generated.ts` has:

| Export | Use it for |
|---|---|
| `Case` | the row type — `client.me.list<Case>(…)`, `get<Case>(…)` |
| `CaseField` | the column-name union, for `QueryOptionsFor<CaseField>` so a misspelt `select` / `filter` / `orderBy` field fails `typecheck` instead of returning a 400 |
| `CaseCreateInput` / `CaseUpdateInput` | the writable columns only. Read-only and auto-bound columns are left out, so a form that tries to set `statuscode` fails to compile |
| `CaseStatuscode`, `CasePrioritycode`, … | a const object per choice field (`CaseStatuscode.InProgress`), used in filters and comparisons instead of magic numbers |

**The names follow the route name, not the Dataverse entity.** Route `case` gives `Case`, `casenotes` gives `Casenotes`, and a scope that publishes `incident` gives `Incident`, `IncidentField`, `IncidentStatuscode`. The examples in these references use `case`; check the generated file and use what it actually exports.

Commit the file so a schema change shows up in the diff. Never edit it by hand. When the scope gains a column, run `npm run generate:types` again. If a screen needs a narrower shape, derive it (`Pick<Case, "title" | "ticketnumber">`) rather than declaring a parallel interface.

Then generate the rest of the app. The file layout should be:

```
src/
├── main.tsx                 ← MSAL bootstrap before React mounts, then the provider stack
├── App.tsx                  ← sign-in gate + router
├── auth.tsx                 ← AuthProvider / useAuth — session, getToken, signIn, signOut
├── config/entra.ts          ← msalConfig + assertEntraConfig()
├── env.ts                   ← VITE_API_BASE_URL + VITE_API_SCOPE
├── index.css                ← Tailwind @import
├── lib/client.ts            ← useDataverseClient() hook
├── services/<table>Api.ts   ← SDK-based (fetchX, createX, updateX)
├── hooks/use<Table>.ts      ← React hook for data + state
├── dataverse.generated.ts   ← `npm run generate:types` — committed, never hand-edited
└── components/
    ├── SignInGate.tsx       ← sign-in wall + NoContactNotice
    ├── Header.tsx
    ├── <Table>List.tsx      ← list view with loading/error/empty states
    └── <Table>Detail.tsx    ← detail view
```
