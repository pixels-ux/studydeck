# Web app

A small app with accounts and saved data, ready to become your own product.
The example workspace lets each user create, edit and delete private notes.

## Start and check

```sh
bun install
bun run dev
bun test
bun run typecheck
bun run build
```

Open the URL printed by Vite. The server binds to `0.0.0.0` for Cloud previews
and runs the Worker with a local D1 database. With no auth configuration on a
loopback origin, one clearly labelled local preview identity is used. This
fallback never applies on a hosted origin or to incomplete sign-in config.

## Make it yours

- `src/client/main.tsx`: the React interface and interactions.
- `src/client/style.css`: colors, typography and spacing.
- `src/worker/app.ts`: the private API and authorization.
- `src/worker/auth.ts`: Sign in with Freebuff and local preview identity.
- `src/worker/db.ts`: the D1 schema and row mapping.
- `src/shared/types.ts`: API types shared by browser and server.

Notes are capped at 1000 characters; the workspace lists the newest 100. All
queries bind parameters and scope ownership by the authenticated user's `sub`.
Build on this example instead of introducing another database or auth service.
Add pagination when your product needs longer lists. Schema initialization is
idempotent; append migrations deliberately as the app grows.

## Publish with Freebuff

When the user requests publishing, use the Publish button, or Sites tools:

1. Create/inspect the site and target preview first.
2. Enable Sign in with Freebuff using `sites_enable_auth`. For local login
   testing, supply the dev server's loopback origin and use only the returned
   development configuration locally. Never invent or reuse a client ID.
3. Provision Sites database storage as `DB` using `sites_add_storage`.
4. Build and deploy with `sites_deploy` and `deploy.json`. Sites injects the
   reserved `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN` bindings.
   No application secret or separate cloud account is needed.

Read `node_modules/@freebuff/auth/AGENTS.md` before changing sign-in. The SDK
wraps requests before API/static fallbacks and forwards refreshed session
cookies. Never derive the canonical origin from a request Host. Private routes
authenticate every request, key records by `sub`, reject foreign-origin
mutations and return private/no-store responses. Missing setup is an error,
never anonymous access to hosted data.

For uploaded files, add Sites' `FILES` storage when needed; this starter has
no file feature and does not provision a bucket. For live collaboration, use
Sites' managed realtime tools instead of adding a separate backend. For SSR
requirements, adapt the same project with Sites' supported Next/OpenNext path
rather than asking the user to select another template.

## Run on a plain Node host

The same app also runs on any host that can run `node` (a VPS, Render, Railway,
Fly, a Docker image). No Cloudflare account is involved: the worker is reached
through `src/node/server.ts`, static files come from `dist/client`, and data is
kept in a SQLite file through `src/node/sqlite.ts`, which implements the same
`prepare/bind/first/all/run/batch` surface D1 exposes. The Worker build and
`deploy.json` are unchanged, so Sites keeps working from the same source.

```sh
bun install            # or npm install
bun run build:node     # dist/client + dist/node/server.js
DATABASE_PATH=data/studydeck.db PORT=3000 bun start   # or: node dist/node/server.js
```

Environment:

- `DATABASE_PATH` (default `data/studydeck.db`): the SQLite file; its directory
  is created automatically. Point it at a persistent disk, not an ephemeral one.
- `PORT` / `HOST` (default `3000` / `0.0.0.0`).
- `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `AI_MODEL`) enables the AI
  study desk; without it everything else works and the desk shows a setup card.
- `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER`, `APP_ORIGIN` enable Sign in with
  Freebuff. `APP_ORIGIN` must be the public origin including scheme. A new
  domain also needs one registration run by the owner:
  `npx @freebuff/auth register --project <slug> --name "Studydeck" --environment production --redirect-uri https://<origin>/auth/freebuff/callback`.

With no auth configuration the app still serves, but only a loopback origin
(`http://127.0.0.1:<port>`) gets the single local preview identity. A public
origin without auth configuration shows the sign-in screen and refuses API
writes, by design.

## Verify before publishing

`bun test` uses a real local D1 database through Miniflare to verify CRUD,
two-user isolation, signed-out refusals, origin checks and validation. Test
identities are injected into the app factory only; the shipped Worker always
uses the SDK. Also test the built Worker in workerd with its assets/bindings.
After provisioning, verify actual Freebuff sign-in, callback, refresh and
sign-out in a browser, plus two real accounts' isolation. Unit identities and
a successful redirect do not prove the hosted login flow works. Publishing
and real-account checks require the owner's authorization and setup.
