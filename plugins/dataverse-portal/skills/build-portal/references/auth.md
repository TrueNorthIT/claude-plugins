# Auth — Entra wiring and contact resolution

_Part of the `build-portal` skill. Read it at step 7, before writing `src/config/entra.ts`, `src/main.tsx`, `src/auth.tsx` or the no-contact screen. Section names in italics (*SDK usage*, *Code quality*, *Security*, *Entra wiring*, *Contact resolution*, *Before you publish*) are listed with their files at the end of SKILL.md._

## Entra wiring — the four files that must be right

Nothing here is optional or interchangeable. Each piece exists because its absence produces a specific, badly-signposted failure.

**`src/config/entra.ts` — MSAL configuration.**

```ts
export const entraConfig = {
  tenantId: import.meta.env.VITE_ENTRA_TENANT_ID ?? '',
  clientId: import.meta.env.VITE_ENTRA_CLIENT_ID ?? '',
  /** e.g. `api://<api-app-id>/access_as_user` — the audience the API expects. */
  apiScope: import.meta.env.VITE_ENTRA_API_SCOPE ?? '',
  /**
   * Must be registered on the app registration as a Single-page application
   * redirect URI, or sign-in fails at the IdP before the app ever sees it.
   * `window.location.origin` keeps localhost and the deployed URL on one config.
   */
  redirectUri: window.location.origin,
}

export const msalConfig = {
  auth: {
    clientId: entraConfig.clientId,
    authority: `https://${entraConfig.tenantId}.ciamlogin.com/${entraConfig.tenantId}`,
    // Required: MSAL rejects an authority outside its known list otherwise.
    knownAuthorities: [`${entraConfig.tenantId}.ciamlogin.com`],
    redirectUri: entraConfig.redirectUri,
    postLogoutRedirectUri: entraConfig.redirectUri,
  },
  // Per tab: survives a refresh, ends when the tab closes, so the app's tokens
  // don't outlive the visit, and someone returning the next day gets a clean
  // sign-in rather than a stale account whose refresh token has expired.
  cache: { cacheLocation: 'sessionStorage' as const },
}
```

Closing the tab ends the app's tokens, not the identity provider's own session, which lasts until the browser closes (or longer, if the user ticked "stay signed in"). On a shared or library PC the next person who clicks *Sign in* can land in the previous citizen's session without a password. Only `logoutRedirect` ends both, so sign-out must be one click away on every page.

Neither storage choice protects a token from script running in the page. MSAL v5 encrypts its `localStorage` cache, but with a key it keeps in a cookie the page's own script can read, and any injected script can simply ask MSAL for a fresh token anyway. The defence against token theft is keeping attacker script off the page — see `references/code-security.md`.

Also export an `assertEntraConfig()` that throws a named-variable error when any of the three is empty — **called from `bootstrap()`, never run at module scope.** Throwing on import happens before any error handler exists, and the result is a blank white page, which is the least diagnosable failure there is. The most likely cause is also the most boring one: an unset variable on a fresh deploy.

**`src/main.tsx` — bootstrap before React mounts.**

```ts
async function bootstrap() {
  assertEntraConfig()
  const pca = new PublicClientApplication(msalConfig)

  // MSAL does not set an active account on login by itself, and
  // `acquireTokenSilent` needs one — without this every request after a fresh
  // sign-in fails until the page is reloaded.
  pca.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      const { account } = event.payload as AuthenticationResult
      if (account) pca.setActiveAccount(account)
    }
  })

  await pca.initialize()
  // Must run before anything reads the account list, or the first render after
  // returning from the IdP sees a signed-out app and bounces the user back to
  // sign in — a loop that looks like a broken login.
  await pca.handleRedirectPromise()
  if (!pca.getActiveAccount()) {
    const [first] = pca.getAllAccounts()
    if (first) pca.setActiveAccount(first)
  }

  createRoot(root).render(/* provider stack below */)
}

bootstrap().catch((err) => { /* render the message into #root as plain DOM */ })
```

Everything before React mounts sits outside any error boundary, so the `catch` must paint the message into the page itself, with plain DOM — whatever failed may well be the reason React cannot start.

**Provider order is load-bearing:**

```
MsalProvider → QueryClientProvider → AuthProvider → BrowserRouter → routes
```

`useAuth` reads MSAL, so `AuthProvider` must sit inside `MsalProvider`; anything that fetches must sit inside `AuthProvider`.

**The `QueryClient` needs two non-default settings:**

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // Never retry a 4xx, and this matters more than it looks. Query's retryer
      // only continues while the tab is focused: a scheduled retry in a hidden
      // tab PAUSES, and the query is left at status 'pending' even though it
      // has already failed — so the user sits on a spinner that never resolves
      // and the real cause sits unread in `fetchFailureReason`. A 403 is a
      // permission answer and a 404 is often "no contact record"; neither will
      // succeed on a second attempt, so failing fast is what makes the error
      // reach the component at all. Only 5xx and transport failures retry.
      retry: (count, error) => {
        const status = (error as { status?: number })?.status
        if (typeof status === 'number' && status >= 400 && status < 500) return false
        return count < 1
      },
      // The other half: an offline verdict should not park a request either.
      networkMode: 'always',
    },
    mutations: { retry: false, networkMode: 'always' },
  },
})
```

Read loading state from `isSuccess`, not `!isLoading && !error`. A query can sit pending with nothing in flight — paused, disabled, or never started — and inferring "no records" from that tells someone their data is gone when you never actually asked.

**`src/auth.tsx` — session and token acquisition.** Expose `session`, `isBusy` (`inProgress !== 'none'` — mid-redirect is neither signed in nor signed out, and rendering a sign-in button there invites a second login on top of the one already running), `getToken`, `signIn`, `signOut`.

`getToken` acquires silently on every call — MSAL caches and refreshes behind it, so it is cheap, and a long-lived tab never sends a stale token. It must catch **both** error types:

```ts
try {
  const result = await instance.acquireTokenSilent({ scopes: [apiScope], account })
  return result.accessToken
} catch (err) {
  // Silent renewal happens in a hidden iframe. When the browser blocks
  // third-party cookies — increasingly the default — the iframe never
  // completes and MSAL gives up with `timed_out`, which is a BrowserAuthError
  // and NOT an InteractionRequiredAuthError. Escalating only on the latter
  // leaves a signed-in user on loading skeletons forever, on every page, with
  // no cure but signing out and back in by hand.
  const timedOut = err instanceof BrowserAuthError && /timed_?out|timeout/i.test(err.errorCode)
  if (err instanceof InteractionRequiredAuthError || timedOut) {
    await instance.acquireTokenRedirect({ scopes: [apiScope], account })
  }
  throw err
}
```

A full-page redirect isn't subject to the restriction that stopped the iframe, and when the IdP session is still alive it returns without prompting for anything.

**A dev-token escape hatch, for when there is no Entra account to hand.** Worth having for development and demos — and it has to be unreachable in anything you ship:

```ts
// Dev-only twice over: import.meta.env.DEV is false in any built bundle, and
// the token still has to be supplied explicitly. The API validates it, resolves
// the contact, and applies exactly the same permissions and row-scoping, so
// nothing downstream can tell the difference — which is precisely why it must
// never be pointed at production.
const demoToken = import.meta.env.DEV ? import.meta.env.VITE_DEMO_TOKEN : undefined
if (demoToken) {
  return {
    session: { email: import.meta.env.VITE_DEMO_EMAIL },
    isBusy: false,
    getToken: async () => demoToken,
    signIn: () => {},
    signOut: () => {},
  }
}
```

The token is an HMAC key minted against a deployment whose `MCP_KEY_SECRET` you know — `npm run forge-key -- <email> <contact-guid> <scope>` in the API repo. It is a credential, so it goes in **`.env.development.local`**: gitignored by the template's `*.local` rule, and loaded only by the dev server. **Not `.env.local`** — Vite loads that file for `vite build` as well, so a production build on that machine has the token in hand. Never `.env`, never a commit, and never a token for a production deployment.

## Contact resolution — the 404 to design for

The API resolves the Dataverse contact from the token's **lowercased `email` claim**, matched against `contact.emailaddress1`. Not `oid`, not `sub`. An account whose email has no matching contact authenticates perfectly, gets a valid token, and then 404s on every `me` route.

This is a routine outcome with a real IdP, it says nothing is wrong with the user's credentials, and the fix is a different account rather than anything they can retry. Render it as its own thing:

```tsx
// A 404 here means the token was fine but no Dataverse contact carries that
// email. Worth naming rather than showing a generic failure.
const noContact = (error as { status?: number } | null)?.status === 404
{error && noContact && <NoContactNotice email={session?.email} />}
```

`NoContactNotice` should say which email they're signed in as, suggest they may have used a different address, and offer `signOut` as "sign in as someone else".

If tokens carry no `email` claim at all, that is an API-side fix, not a frontend one — either add `email` as an optional access-token claim on the **API** app registration (Token configuration → Add optional claim → Access → `email`), or set `{SCOPE}__OIDC_EMAIL_CLAIM=preferred_username` on the API deployment. Tell the user which; don't work around it in the SPA. Prefer the first. The API takes whatever the claim says as the caller's identity, with no check that the address was verified — and when the configured claim is missing it falls back to `email`, then `preferred_username`, then `emails[]`. Every claim on that chain should be one the identity provider has verified and the user cannot edit.
