# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

This is the **backend of Genesis**, a generative AI app builder: users describe an app in chat, an LLM generates a fixed three-file web app (`index.html`, `app.js`, `styles.css`), and the app runs in a sandboxed preview with live access to the user's HighLevel (GoHighLevel) CRM data. The frontend lives in `../frontend` (Vite/React SPA).

The backend is a set of **Firebase Cloud Functions (gen 2, TypeScript)** covering: HighLevel OAuth, a whitelisted HL REST proxy, an SSE-streaming generation orchestrator around the Anthropic Messages API, project CRUD callables, and content-addressed file snapshots in Firestore.

**`backend-implementation.md` is the authoritative spec.** It defines every function, document shape, security rule, and invariant. Read the relevant section before implementing or changing anything; do not contradict it. The current `functions/src/index.ts` is scaffold-only — most modules described below still need to be written.

Implemented so far: the full CRUD surface, structured per the team's "Firestore CRUD Functions" artifact (layered MVC, one responsibility per file):

- `config/firebase.ts` — Admin SDK init + `setGlobalOptions` (imported FIRST in `index.ts`).
- `models/` — document shapes + Firestore converters + typed refs (`user.model.ts`, `project.model.ts`, `snapshot.model.ts`, `system.model.ts` for server-only/future docs).
- `schemas/` — zod input schemas, shared by REST and callables; input types derive from them.
- `services/` — all business logic and all Firestore access; transport-agnostic (no `req`/`res`).
- `controllers/` — thin HTTP↔service translation; `routes/` — URL→middleware→controller wiring.
- `middleware/` — `require-auth` (Bearer ID token → `res.locals.identity`), `validate` (replaces `req.body` with parsed input), `error-handler` (the ONLY place errors become responses, emitting the spec's `{code, message, retryAfter?}` contract).
- `callables/` — the spec's seven `onCall` functions via the shared `utils/callable.ts` wrapper; they reuse the same services as REST.
- `triggers/` — `onProjectCreated` (log-only); `utils/` — `app-error.ts` (spec error taxonomy), `async-handler.ts`, `ids.ts`, `identity.ts`; `templates/` — starter tree.

Deployed functions: `api` (Express REST app: `/healthz`, `/users/*`, `/projects/*` incl. nested `/files` and `/snapshots`), the seven callables (`createUserProfile`, `createProject`, `renameProject`, `softDeleteProject`, `restoreProject`, `saveSnapshot`, `restoreSnapshot`), and `onProjectCreated`. REST base locally: `http://127.0.0.1:5001/<project-id>/us-central1/api`.

Deliberate deviation from the artifact: `firestore.rules` keep the genesis spec's owner-read rules (NOT deny-all) because the frontend reads Firestore directly; versions stay on `firebase-functions@^5`/`firebase-admin@^12` per the genesis spec. Emulator quirk: don't `orderBy(FieldPath.documentId(), "desc")` — descending key scans are unsupported; order by `createdAt` instead.

Also implemented: HighLevel OAuth as REST routes under `/oauth/hl` (`connect` = frontend posts the `?code` from the marketplace redirect, backend exchanges + encrypts + stores `hlConnections/{uid}` and mirrors `users/{uid}.hl`; `token` = spec §5.3 lazy single-flight refresh, returns the access token to the authenticated caller — a deliberate deviation from INV-2's proxy-only design, requested for the current milestone; `status`). Deviation from spec §5.1/5.2: the frontend owns the redirect (no `oauthStart`/`oauthCallback` functions, no `oauthStates` docs); the code exchange is authenticated by the Firebase ID token instead of a state doc. Secrets bind to `api` via `config/secrets.ts`; local dev reads `functions/.secret.local` (gitignored) and `HL_REDIRECT_URI` from `functions/.env.local`. Still to build: proxy, generate, cancel (deps `@anthropic-ai/sdk`, `acorn` land with them).

## Commands

The repo root `package.json` pins `firebase-tools` locally (the globally installed standalone CLI bundles Node 16 and cannot load `firebase-functions` v5 — always use the local one via `npm run` or `npx firebase`).

From the repo root:

```bash
npm run emulators        # npx firebase emulators:start (auth :9099, functions :5001, firestore :8080, UI :4000)
npm run build            # tsc in functions/ → functions/lib/
npm run lint             # eslint in functions/
npm run deploy:functions
npm run deploy:firestore # rules + indexes
```

Inside `functions/`: `npm run build:watch`, `npm run logs`. The functions emulator hot-reloads on rebuild — keep `build:watch` running while developing. Tests are vitest (see spec §11): `npx vitest run` for all, `npx vitest run <file>` for one; rules tests require the Firestore emulator. HighLevel calls hit a real sandbox account (no emulator exists); Anthropic calls use a real dev key.

Local smoke test for callables: sign up via the Auth emulator REST API (`POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`), then POST to `http://127.0.0.1:5001/<project-id>/us-central1/<fn>` with `Authorization: Bearer <idToken>` and a `{"data": {...}}` body.

Secrets (`ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY`) are managed via `firebase functions:secrets:set` and bound per-function with `defineSecret` — never in `functions:config` or source.

## Architecture

### Function inventory (spec §2)

- `generate` — raw `onRequest`, POST, SSE streaming. The core: single-flight lock → context assembly → Anthropic stream → tag parsing → validation gates → atomic commit. 1 GiB / 540 s / concurrency 1.
- `hlProxy` — raw `onRequest`, `/hl/*`. Whitelist-only proxy from generated-app `window.hl.*` calls to HighLevel REST.
- `oauthStart` / `oauthCallback` — HL marketplace OAuth (state doc in Firestore, not cookies).
- Callables: `createProject`, `renameProject`, `softDeleteProject`, `restoreProject`, `saveSnapshot`, `restoreSnapshot`, `cancelGeneration`.

`generate` and `hlProxy` are invoked at their **direct run.app URLs, never through Hosting rewrites** — Hosting buffers responses and caps at 60 s, which silently kills SSE.

### Source layout (spec §1)

`functions/src/` is organized by feature, with shared code in `lib/`:

- `index.ts` — re-exports every deployed function; nothing else.
- `oauth/`, `proxy/`, `generate/`, `projects/`, `snapshots/`, `cancel/` — one directory per feature; handlers stay thin and delegate to focused modules (e.g. `generate/` splits into `parser.ts` (pure, no I/O), `context.ts`, `gates.ts`, `commit.ts`, `repair.ts`).
- `lib/` — `db.ts` (ALL Firestore document types + converters live here, nowhere else), `auth.ts`, `hlClient.ts`, `crypto.ts`, `sse.ts`, `rateLimit.ts`, `errors.ts`, `ids.ts`.

### Invariants that shape everything

1. **INV-2 / proxy pattern**: HL tokens exist only inside functions — AES-256-GCM encrypted at rest (AAD = uid), in the server-only `hlConnections/{uid}` collection that rules deny entirely. The proxy injects `locationId` server-side; generated code can never target another location.
2. **Fixed three-file contract**: the model may only touch `index.html`, `app.js`, `styles.css`. Path validation is membership in `ALLOWED_PATHS` (`lib/db.ts`).
3. **INV-3 / single-flight lock**: `projects/{pid}.activeGenerationId` is set and cleared transactionally; every terminal path clears it in the same batch that writes the terminal status.
4. **INV-4 / content-addressed versioning**: immutable `blobs/{sha256}` + snapshot manifests. Blobs are written before the commit batch, so no crash point leaves a snapshot referencing a missing blob. Orphan blobs are harmless by design — there is deliberately no GC.
5. **INV-6 / SSE is an optimization, the generation doc is truth**: every stream ends with exactly one `done` or `error` event; client disconnect does NOT cancel — cancellation requires the `cancellations/{generationId}` intent doc written by the `cancelGeneration` callable.
6. Server-managed fields (`headSnapshotId`, `activeGenerationId`, `updatedBy` values other than `'user'`) are unreachable from clients — enforced by `firestore.rules`, which must stay in sync with spec §3.2.

### Error handling and logging

- All non-2xx HTTPS responses are `AppError` (`lib/errors.ts`) serialized as `{ code, message, retryAfter? }`. Use the existing `ErrorCode` taxonomy; do not invent ad-hoc error shapes. Proxy error messages are user-facing — generated apps render them verbatim.
- Use `firebase-functions/logger` (structured), not `console.*`. Log at info for lifecycle events (generation start/terminal state, OAuth exchange, token refresh, commit) and at error with a correlation id (generationId / uid) for every failure path and upstream 4xx/5xx. Never log tokens, decrypted secrets, or full file contents.

### Coding standards

- TypeScript strict throughout; validate all external input (request bodies, query params, callable data) with zod `.strict()` schemas at the boundary.
- One concern per file, small focused functions; put anything used twice in `lib/` rather than duplicating it. Document field names exist only in `lib/db.ts`.
- Keep comments minimal — only for non-obvious constraints (e.g. why a transaction re-read exists); the spec carries the rationale.
- IDs: ULIDs for sortable doc ids (`newId()`), `fileId(path)` = base64url(path), `sha256hex` over UTF-8 bytes — all from `lib/ids.ts`.
- Multi-doc consistency uses a single `WriteBatch` or transaction; never sequential writes that can be interrupted between related docs.
