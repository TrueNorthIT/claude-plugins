# Security — what the generated code must not do

_Part of the `build-portal` skill. Read it at step 7, before writing any component that renders API data, builds a link, reads a route param or handles an error. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

The API enforces row scoping, permissions and column write rules on every request, whatever the browser does. The portal can't leak more than the scope allows, and hiding things in the UI protects nothing. What the API can't protect is the page itself. Script that gets into the page *is* the signed-in citizen: it can call the API with their token and every permission they hold. Each rule below closes off one route to that, or a mistake the server can't catch.

**Use the tier the user chose, and never widen it to fix something.** `client.me` unless they asked for a team or admin view. An empty `me` list or a 404 is a join or contact problem (see *Contact resolution* in `references/auth.md`, and step 5). Switching to `client.team` or `client.all` either gets a 403, or shows the citizen everyone's rows once someone grants the permission to make the 403 go away. Never ask for an `:all` grant to make a citizen portal work.

**Render API text as text.** `{value}` in JSX escapes, and that covers almost everything. But Dataverse holds HTML in places — email bodies, rich-text notes, knowledge articles — written by staff, by citizens, and by anyone who has emailed the organisation. Where the formatting really matters, sanitise with DOMPurify, which works from an allow-list. A hand-written filter that strips `<script>` misses dozens of other ways in:

```tsx
import DOMPurify from "dompurify";

// The one acceptable dangerouslySetInnerHTML: sanitised, in one component, so a
// reviewer can find every place HTML from the API reaches the page.
export function SafeHtml({ html }: { html: string | undefined }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html ?? "") }} />;
}
```

A link built from a field gets its scheme checked first:

```ts
// https, mailto and tel only — a "javascript:" website field is a script.
export function safeHref(url: string | undefined): string | undefined {
  try {
    return url && ["https:", "mailto:", "tel:"].includes(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}
```

**Check route params before they reach the SDK.** `/case/:id` comes from the address bar, and the SDK puts an id into the request path exactly as given, with the citizen's token on the request. Accept GUIDs only:

```ts
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!id || !GUID.test(id)) return <NotFound />;
```

Likewise `fetchPage`: hand it the `page.next` the API returned and nothing else. SDK 1.24.0 and later refuse a URL off the API's origin; older versions send the bearer token to whatever URL they are given.

**Nothing secret in `VITE_*`.** Vite inlines every `VITE_` variable the code reads into the bundle every visitor downloads. Read each one by name (`import.meta.env.VITE_API_SCOPE`): a dynamic `import.meta.env[name]` makes Vite inline the whole set, used or not. The admin connection key, MCP keys, service-principal secrets and Web PubSub or SignalR access keys never belong in a single-page app's environment. If a feature needs one, it needs a server.

**Citizens see a friendly message, not the API's.** `ApiError.message` is the server's own text: written for developers, naming permissions and echoing the request back. (From API 1.24.0, Dataverse's raw error text is replaced by a generic message and a correlation id; older deployments pass it on.) Map on status for the screen, and log the error itself where you catch it:

```ts
// What a citizen reads. The no-contact 404 gets NoContactNotice instead (references/auth.md).
export function friendlyError(err: unknown): string {
  const { status, code } = (err ?? {}) as { status?: number; code?: string };
  // Stable codes (SDK 1.27.0+) say why a signed-in person can't get in at all.
  if (code === "contact_not_enabled") return "Your account isn't set up for online access yet. Please contact us.";
  if (code === "access_withdrawn") return "Your access has been withdrawn. Please contact us.";
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "We couldn't find that.";
  return "Something went wrong. Please try again.";
}
```

**Files: link on click, never inline.** A note's attachment and an email's attachments come through `client.me.files(table, id)` (names, types, sizes) and `client.me.fileLink(table, id, fileId)`, which returns a URL that works for a few minutes. Request the link in the click handler and navigate to it (`window.location.assign`). Don't prefetch it, cache it (TanStack Query included), log it or send it to analytics: until it expires, anyone holding it can download the file. Never `fetch` a file into the page, or turn it into a `blob:` or `data:` URL to preview it: an HTML or SVG attachment would then run as the portal. Never `select` `documentbody` or `body`. For an email, render its `description` with `SafeHtml`.

**Realtime events are a reason to refetch, not data.** An event's `recordId` says something changed. It doesn't say this citizen may see it. Invalidate the matching queries and let the scoped route answer; never render from the event.

**Query keys carry identity.** With a company switcher (`withCompany`), put the selected company id in every query key, or the cache shows one company's rows under another's name until the refetch lands. On sign-out, clear what the app stored itself (a remembered company, preferences) as well as letting `logoutRedirect` clear MSAL's cache. Don't persist the query cache to storage: on a shared computer, that is the previous person's data.

**Hiding a button is not a permission.** Hiding what the API would refuse anyway is good UX. Hiding something the API would *allow* is a hole waiting for anyone with `curl`. Staff and admin features don't belong in a citizen portal behind an email check; they belong in a separate app, with access granted per person.

**No session replay or analytics on signed-in pages without consent, and never an email address as the identifier.** Session replay records what is on screen, and in a portal that is personal data.

**A CAPTCHA in the page doesn't protect a public endpoint.** If the scope has a `publicCreate` route, anyone can call it without going through the portal. Rate limiting belongs at the edge, in front of the API: tell whoever runs the deployment.

Before anyone else uses the portal, set the response headers and run the checks in `references/security.md` (relative to this skill's directory). The `review-portal` skill in this plugin runs the same review against the code, and is the one to reach for on a portal this skill didn't generate.
