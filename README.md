# Genesis Backend — Firebase Cloud Functions

Backend for Genesis, a generative AI app builder. Firebase Cloud Functions (gen 2, TypeScript) providing HighLevel OAuth, a whitelisted HL REST proxy, an SSE-streaming generation orchestrator, project CRUD, and content-addressed file snapshots in Firestore.

## Prerequisites

- **Node 20** (required by `functions/package.json` engines)

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

## Secrets

Runtime secrets are bound per-function with `defineSecret` (see `functions/src/config/secrets.ts`) — never put them in `functions:config` or source.

| Name | Where to get the value | Used by |
| --- | --- | --- |
| `HL_CLIENT_ID` | HighLevel marketplace → your app → Settings → Client Keys | `api` (`/oauth/hl/*`) |
| `HL_CLIENT_SECRET` | Same place as the client id | `api` (`/oauth/hl/*`) |
| `TOKEN_ENC_KEY` | Generate: `openssl rand -base64 32` (32 random bytes, base64) | `api` — encrypts HL tokens at rest |
| `ANTHROPIC_API_KEY` | Anthropic console → API Keys → Create Key | `api` (generation orchestrator — `POST /generate`) |

### Local (emulator)

The emulator reads secrets from `functions/.secret.local` and plain env vars from `functions/.env.local` — both are **gitignored; never commit them**. Create them like this:

```bash
# functions/.secret.local
HL_CLIENT_ID=<your marketplace app client id>
HL_CLIENT_SECRET=<your marketplace app client secret>
TOKEN_ENC_KEY=<output of: openssl rand -base64 32>
ANTHROPIC_API_KEY=<your Anthropic API key>
```

```bash
# functions/.env.local
HL_REDIRECT_URI=http://localhost:5173/oauth/callback
```

`HL_REDIRECT_URI` is not a secret — it's the fallback redirect URI for the code exchange and must byte-match a redirect URL registered in the marketplace app (the frontend can also pass `redirectUri` per request). Restart the emulator after changing either file.

### Production

Store each secret in Secret Manager (prompts for the value, then redeploy the functions that use it):

```bash
npx firebase functions:secrets:set HL_CLIENT_ID
npx firebase functions:secrets:set HL_CLIENT_SECRET
npx firebase functions:secrets:set TOKEN_ENC_KEY
npx firebase functions:secrets:set ANTHROPIC_API_KEY
npm run deploy:functions
```

For `HL_REDIRECT_URI` in production, put it in `functions/.env` (non-secret env files are deployed) or have the frontend always send `redirectUri` in the `/oauth/hl/connect` body.

> Rotating `TOKEN_ENC_KEY` invalidates every stored HighLevel connection — existing token envelopes stop decrypting and users must reconnect (by design, spec §4.2).

## Deploying for the first time

Complete walkthrough for a fresh machine and a fresh Firebase/HighLevel setup, in order.

### 1. Create the HighLevel marketplace app (client id + secret)

This is where `HL_CLIENT_ID` / `HL_CLIENT_SECRET` come from.

1. Sign up for a **developer account** at [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com/) (separate from a normal agency login).
2. **My Apps → Create App.** Pick a name; for distribution choose **Sub-Account** (a.k.a. Location) — the backend requires location-level installs and rejects agency-level ones. "Private" app type is fine while developing.
3. **Settings → Scopes** — enable exactly the working set from the spec:

   ```
   contacts.readonly contacts.write conversations.readonly
   conversations/message.readonly conversations/message.write
   calendars.readonly calendars/events.readonly locations.readonly
   ```

4. **Settings → Redirect URLs** — add every URL the OAuth flow may return to, one per environment. They must **byte-match** what the backend sends (`HL_REDIRECT_URI` or the request's `redirectUri`):

   - `http://localhost:5173/oauth/callback` (local frontend dev)
   - `https://genesis-crm-app.web.app/oauth/callback` (production)

5. **Settings → Client Keys → Add** — this generates the **Client ID** and **Client Secret**. Copy the secret immediately; it is shown only once. These are the values for the secrets in the section above.
6. **Webhook URL** — leave it empty. This backend doesn't consume HL webhooks; OAuth uses redirect URLs, not webhooks.

### 2. Firebase project prerequisites (console, one-time)

- Upgrade the project to the **Blaze (pay-as-you-go) plan** — gen-2 functions and Secret Manager won't deploy on Spark.
- **Authentication → Sign-in method** — enable **Email/Password** (production auth is separate from the emulator).
- CLI login: `npx firebase login` (from the repo root, so the pinned CLI is used).

### 3. Configure secrets and env

- Set the four production secrets (see the [Secrets](#secrets) section): `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `ANTHROPIC_API_KEY`.
- Create `functions/.env` (must be inside `functions/`, not the repo root):

  ```bash
  # functions/.env
  HL_REDIRECT_URI=https://genesis-crm-app.web.app/oauth/callback
  ```

### 4. Build the frontend

```bash
cd ../frontend && npm run build && cd -
```

Hosting deploys a copy of `../frontend/dist` (a predeploy hook in `firebase.json` copies it to `hosting/dist`, since the Firebase CLI refuses `public` paths outside the project directory). Rebuild the frontend before any deploy that should ship UI changes.

### 5. Deploy

```bash
npm run deploy:firestore                          # rules + indexes first
npx firebase deploy --only functions,hosting      # functions (lint+build predeploy) + site
```

### 7. Verify

```bash
curl https://us-central1-<project-id>.cloudfunctions.net/api/healthz   # → {"ok":true}
```

Open the hosting URL (e.g. `https://genesis-crm-app.web.app`), sign up, and run the HighLevel connect flow end-to-end: the frontend redirects to the marketplace `chooselocation` page, HL redirects back with `?code=`, and the frontend posts it to `POST /oauth/hl/connect`.

## Notes & gotchas

- The `POST /generate` endpoint streams via SSE and must be invoked at the direct Cloud Run URL, never through Hosting rewrites — Hosting buffers responses and caps at 60 s, which silently kills SSE. The function is configured with 1 GiB memory and 540 s timeout.
- Emulator quirk: descending scans on document ID are unsupported — order by `createdAt` instead of `orderBy(FieldPath.documentId(), "desc")`.