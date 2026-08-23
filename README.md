# Genesis Backend — Firebase Cloud Functions

Backend for Genesis, a generative AI app builder. Firebase Cloud Functions (gen 2, TypeScript) providing HighLevel OAuth, a whitelisted HL REST proxy, an SSE-streaming generation orchestrator, project CRUD, and content-addressed file snapshots in Firestore.

**`backend-implementation.md` is the authoritative spec** — read the relevant section before changing anything.

## Prerequisites

- **Node 20** (required by `functions/package.json` engines)
- **Java 11+** (required by the Firestore emulator)
- A Firebase project — the default is `highlevel-assignment-20de2` (see `.firebaserc`)

> **Important:** always use the locally pinned `firebase-tools` (via `npm run …` or `npx firebase …` from the repo root). The globally installed standalone Firebase CLI bundles Node 16 and cannot load `firebase-functions` v5.

## Install

```bash
# from the repo root
npm install                # installs the pinned firebase-tools
npm --prefix functions install
```

## Running locally

The functions must be compiled to `functions/lib/` before the emulator can serve them:

```bash
npm run build              # one-off: tsc in functions/
npm run emulators          # starts auth, functions, firestore + emulator UI
```

While developing, keep a watch build running in a second terminal — the functions emulator hot-reloads on rebuild:

```bash
cd functions && npm run build:watch
```

Emulator ports (from `firebase.json`):

| Service   | URL                     |
| --------- | ----------------------- |
| Auth      | http://127.0.0.1:9099   |
| Functions | http://127.0.0.1:5001   |
| Firestore | http://127.0.0.1:8080   |
| UI        | http://127.0.0.1:4000   |

## Calling the functions locally

Deployed functions: `api` (Express REST app), seven callables (`createUserProfile`, `createProject`, `renameProject`, `softDeleteProject`, `restoreProject`, `saveSnapshot`, `restoreSnapshot`), and the `onProjectCreated` trigger.

**REST base URL:**

```
http://127.0.0.1:5001/highlevel-assignment-20de2/us-central1/api
```

Routes: `/healthz`, `/users/*`, `/projects/*` (including nested `/files` and `/snapshots`).

**Smoke test a callable:**

1. Create a user via the Auth emulator REST API:

   ```bash
   curl -s -X POST \
     'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key' \
     -H 'Content-Type: application/json' \
     -d '{"email":"dev@example.com","password":"password123","returnSecureToken":true}'
   ```

   Grab the `idToken` from the response.

2. Call the function with a callable-shaped body (`{"data": {...}}`):

   ```bash
   curl -s -X POST \
     'http://127.0.0.1:5001/highlevel-assignment-20de2/us-central1/createProject' \
     -H "Authorization: Bearer <idToken>" \
     -H 'Content-Type: application/json' \
     -d '{"data":{"name":"My app","description":"demo"}}'
   ```

## Other commands

From the repo root:

```bash
npm run lint               # eslint in functions/
npm run deploy:functions   # deploy functions (predeploy runs lint + build)
npm run deploy:firestore   # deploy firestore rules + indexes
```

Inside `functions/`:

```bash
npm run logs               # firebase functions:log
```

## Tests

Tests use vitest (spec §11):

```bash
cd functions
npx vitest run             # all tests
npx vitest run <file>      # a single file
```

Firestore rules tests require the Firestore emulator to be running. HighLevel calls hit a real sandbox account (no HL emulator exists); Anthropic calls use a real dev key.

## Secrets

Runtime secrets (`ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY`) are managed with Secret Manager and bound per-function with `defineSecret` — never put them in `functions:config` or source:

```bash
npx firebase functions:secrets:set ANTHROPIC_API_KEY
```

## Notes & gotchas

- `generate` and `hlProxy` (once built) must be invoked at their direct Cloud Run URLs, never through Hosting rewrites — Hosting buffers responses and caps at 60 s, which silently kills SSE.
- Emulator quirk: descending scans on document ID are unsupported — order by `createdAt` instead of `orderBy(FieldPath.documentId(), "desc")`.
