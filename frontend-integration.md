# Frontend Integration Guide

How the Genesis frontend (`../frontend`, Vue 3 + Pinia) should call the backend **as it exists today**. This covers only what is deployed: email auth, user profiles, project CRUD, files, and snapshots. **LLM generation is fully mocked on the frontend** (the "send" flow below simulates it with seed files), and **no HighLevel integration exists yet** — `hl.connected` will always be `false` and `hlLocationId` will always be `null`.

- Firebase project: `highlevel-assignment-20de2`, region `us-central1`.
- Everything requires a signed-in Firebase Auth user except `GET /healthz`.

---

## 1. Three transports — when to use which

The backend exposes the same services over two transports, and Firestore security rules additionally allow the owner to read (and in two specific cases write) documents directly. Use them like this:

| Need | Use | Why |
|---|---|---|
| Mutations (create project, rename, delete, restore, save/restore snapshot, create profile) | **Callables** via `httpsCallable` | SDK attaches the ID token and handles refresh for you |
| One-shot reads (project list, project, files, snapshots, profile) | **REST** (`api` function) *or* direct Firestore reads | Equivalent; pick one and stay consistent |
| Live updates (watch a project doc / files while working) | **Firestore `onSnapshot`** | Rules grant the owner read access |
| Mock-LLM file writes (the "send" flow) | **Firestore `updateDoc`** on `projects/{pid}/files/{fileId}` | This is the *only* client-side write path for file content — there is no REST/callable endpoint for it |
| Chat messages (optional, UI-only for now) | **Firestore `addDoc`** on `projects/{pid}/messages` | Rules allow it; the backend does not read messages yet |

**Never** create `projects/{pid}` documents directly in Firestore, even though rules technically permit it — only `createProject` seeds the three files, the seed snapshot, and `headSnapshotId`. A directly-created project doc is broken (no files, no head snapshot). Likewise never write `blobs`, `snapshots`, `headSnapshotId`, or `activeGenerationId` from the client — rules deny all of these.

---

## 2. One-time setup

### 2.1 SDK initialization

Extend `src/lib/firebase.ts` — today it only initializes Auth; Firestore and Functions are needed too:

```ts
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

export const firebaseApp = initializeApp(config)
export const firebaseAuth = getAuth(firebaseApp)
export const firestore = getFirestore(firebaseApp)
export const functions = getFunctions(firebaseApp, 'us-central1') // region is mandatory

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099')
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
```

### 2.2 REST base URL

| Environment | Base |
|---|---|
| Emulator | `http://127.0.0.1:5001/highlevel-assignment-20de2/us-central1/api` |
| Deployed | `https://us-central1-highlevel-assignment-20de2.cloudfunctions.net/api` (or the `api` function's run.app URL from `npx firebase functions:list`) |

Put it in `VITE_API_BASE`. CORS is open (`origin: true`) and the app parses JSON bodies, so plain `fetch` works.

### 2.3 REST fetch helper

All REST endpoints expect `Authorization: Bearer <Firebase ID token>`. Retry exactly once with a force-refreshed token on 401:

```ts
import { firebaseAuth } from '@/lib/firebase'

const API_BASE = import.meta.env.VITE_API_BASE

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) { super(message) }
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const attempt = async (forceRefresh: boolean) => {
    const user = firebaseAuth.currentUser
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
    const token = await user.getIdToken(forceRefresh)
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let res = await attempt(false)
  if (res.status === 401) res = await attempt(true) // expired token → one forced refresh
  if (!res.ok) {
    const err = await res.json().catch(() => ({ code: 'UNKNOWN', message: res.statusText }))
    throw new ApiError(res.status, err.code, err.message, err.retryAfter)
  }
  return res.json() as Promise<T>
}
```

### 2.4 Content helpers (needed by the mock send flow)

The backend content-addresses files by SHA-256 and stores byte sizes. When the frontend writes file docs directly (§7), it **must** compute these identically to the server (`sha256` = lowercase hex over UTF-8 bytes; `size` = UTF-8 byte length; `fileId` = base64url of the path, no padding):

```ts
const encoder = new TextEncoder()

export const byteSize = (content: string): number => encoder.encode(content).length

export async function sha256hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(content))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// File paths are ASCII ("index.html" | "app.js" | "styles.css"), so btoa is safe.
export const fileId = (path: string): string =>
  btoa(path).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
```

A wrong `sha256` here breaks snapshots silently — `saveSnapshot` trusts the file doc's hash as the blob key. Never hand-write these fields.

---

## 3. Auth and tokens

The existing `stores/auth.ts` flow is already correct; this section pins the contract.

- **Sign up**: `createUserWithEmailAndPassword(auth, email, password)` then `updateProfile(user, { displayName })`. Email/password is the only supported provider; the backend **requires an email on the account** (profile creation fails with `VALIDATION_FAILED` otherwise).
- **Sign in**: `signInWithEmailAndPassword(auth, email, password)`.
- **Tokens**: get a fresh ID token per request with `user.getIdToken()`. The SDK caches and auto-refreshes (~1 h lifetime); pass `getIdToken(true)` only on the one-shot 401 retry in §2.3. Callables handle all of this internally — no token code needed for them.
- **Session restore**: gate routing on the first `onAuthStateChanged` (the store's `ready` promise already does this).

There is no backend "login" endpoint — Firebase Auth *is* the login. The backend only verifies the ID token.

---

## 4. Error contract

Every non-2xx REST response has this JSON body (this shape is guaranteed — render `message` directly, it is user-facing):

```json
{ "code": "VALIDATION_FAILED", "message": "Provide a name or a description to update.", "retryAfter": 30 }
```

`retryAfter` (seconds) appears only on rate-limit errors. Codes and statuses in use today:

| Status | `code` | Meaning / frontend handling |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Missing/expired token → force-refresh retry once, then route to sign-in |
| 403 | `FORBIDDEN` | Signed-in user doesn't own the resource → treat as "not yours", show projects list |
| 404 | `NOT_FOUND` | Missing route, project, snapshot, or profile — also returned for *deleted* projects on endpoints that require an active one |
| 409 | `GENERATION_IN_FLIGHT` | Snapshot restore refused while a generation is running (future-proofing; can't happen while LLM is mocked) |
| 422 | `VALIDATION_FAILED` | Body/query/param failed zod validation; `message` says what's wrong |
| 502 | `PERSISTENCE_FAILED` | Snapshot content missing (shouldn't happen) → "try another snapshot" |

Callables throw `FirebaseError` instead. The HTTP status maps to `error.code` (`functions/unauthenticated`, `functions/permission-denied`, `functions/not-found`, `functions/invalid-argument` for 422, `functions/failed-precondition` for 409), and **`error.details` carries the same `{ code, message, retryAfter? }` object** as REST — prefer it for display logic:

```ts
try {
  await createProject({ name })
} catch (e) {
  const err = e as FirebaseError & { details?: { code: string; message: string } }
  toast(err.details?.message ?? 'Something went wrong. Try again.')
}
```

### Timestamps in responses

REST and callable responses serialize Firestore timestamps as `{ "_seconds": number, "_nanoseconds": number }`. Convert with `new Date(t._seconds * 1000)`. Direct Firestore reads give real `Timestamp` objects with `.toDate()` — normalize both in one place if you mix transports.

---

## 5. Scenario: new user signup / returning sign-in

Profile creation is **idempotent** (`{ created: false }` when it already exists), so run the same bootstrap on both signup and sign-in — this also self-heals accounts whose profile call failed the first time.

```
signUp / signIn (Firebase Auth SDK)
        │
        ▼
createUserProfile  ──  callable, { displayName? }   →  { created: boolean }
        │                (REST: POST /users/profile — 201 created, 200 existed)
        ▼
GET /users/me  →  profile        (or read users/{uid} from Firestore directly)
        │
        ▼
route to /projects
```

```ts
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

const createUserProfile = httpsCallable<{ displayName?: string }, { created: boolean }>(
  functions, 'createUserProfile')

export async function bootstrapUser(displayName?: string) {
  await createUserProfile(displayName ? { displayName } : {})
  return api<UserProfile>('GET', '/users/me')
}
```

Contract details:

- `displayName` is **optional**, trimmed, 1–80 chars. When omitted, the backend falls back to the ID token's `name` claim — so if you always call `updateProfile` at signup (the store already does), you can call `createUserProfile({})` with no arguments.
- These are the *only* inputs. `email` is taken from the verified token, `hl.connected` starts `false` and is server-managed, `createdAt` is a server timestamp. The client cannot set any of them.
- Accounts without an email are rejected with 422 `VALIDATION_FAILED`.
- `GET /users/me` returns 404 `NOT_FOUND` until the profile exists.

`GET /users/me` response (also the shape of `users/{uid}` in Firestore):

```json
{
  "email": "ada@example.com",
  "displayName": "Ada",
  "createdAt": { "_seconds": 1755900000, "_nanoseconds": 0 },
  "hl": { "connected": false }
}
```

Replace the hardcoded `hl` mock in `stores/auth.ts` with this real field — it will correctly render "not connected" until the OAuth feature ships. `users/{uid}` is owner-readable in rules, so `onSnapshot(doc(firestore, 'users', uid))` works if you want the profile live.

---

## 6. Scenario: project list screen

### 6.1 Fetch the list

```ts
const { items } = await api<{ items: Project[] }>('GET', '/projects?status=active&limit=50')
```

- `status`: `active` (default) or `deleted` — use `deleted` for a trash view.
- `limit`: 1–100, default 20.
- Ordered by `updatedAt` descending (most recently touched first).

Each item:

```json
{
  "id": "aB3xK9...",
  "ownerUid": "uid123",
  "name": "CRM dashboard",
  "description": "",
  "hlLocationId": null,
  "status": "active",
  "deletedAt": null,
  "headSnapshotId": "01J5ZK3M9QWERTYUIOPASDFGHJ",
  "activeGenerationId": null,
  "createdAt": { "_seconds": 1755900000, "_nanoseconds": 0 },
  "updatedAt": { "_seconds": 1755990000, "_nanoseconds": 0 }
}
```

(No direct-Firestore equivalent for the *list* unless you replicate the query: `where('ownerUid','==',uid)`, `where('status','==','active')`, `orderBy('updatedAt','desc')` — the composite index for it is already deployed. REST is simpler; use it.)

### 6.2 Create a project

```ts
const createProject = httpsCallable<
  { name: string; description?: string },
  { projectId: string; snapshotId: string }
>(functions, 'createProject')

const { data } = await createProject({ name: 'CRM dashboard' })
// → route to /p/${data.projectId}
```

- `name` required, 1–80 chars; `description` optional, ≤ 500 chars, defaults to `""`.
- The backend atomically seeds `index.html`, `app.js`, `styles.css` (starter template), writes their blobs, creates a `"Starter template"` seed snapshot, and points `headSnapshotId` at it. **A new project is immediately openable — files exist from the first millisecond.**
- REST equivalent: `POST /projects` → 201, same response body.

### 6.3 Rename / edit description

```ts
const renameProject = httpsCallable<
  { projectId: string; name?: string; description?: string },
  { projectId: string }
>(functions, 'renameProject')
```

At least one of `name`/`description` is required (422 otherwise). Rejected with 404 if the project is deleted. REST: `PATCH /projects/:projectId` with `{ name?, description? }`.

### 6.4 Soft delete and restore

```ts
const softDeleteProject = httpsCallable<{ projectId: string }, { projectId: string; status: 'deleted' }>(functions, 'softDeleteProject')
const restoreProject   = httpsCallable<{ projectId: string }, { projectId: string; status: 'active' }>(functions, 'restoreProject')
```

Delete is soft: the doc gets `status: 'deleted'` + `deletedAt`, disappears from the `active` list, and appears under `status=deleted`. All files/snapshots survive; restore flips it back. REST: `DELETE /projects/:projectId` and `POST /projects/:projectId/restore`. Both are idempotent enough to call from an undo toast.

---

## 7. Scenario: selecting (opening) a project

Three fetches populate the workspace — run them in parallel:

```ts
const [project, files, snapshots] = await Promise.all([
  api<Project>('GET', `/projects/${pid}`),
  api<{ items: ProjectFile[] }>('GET', `/projects/${pid}/files`),
  api<{ items: Snapshot[] }>('GET', `/projects/${pid}/snapshots?limit=20`),
])
```

- `GET /projects/:projectId` — 404 if missing **or** you'll get 403 if it belongs to someone else. A `status: 'deleted'` project is still returned here (so a trash view can show it), but `/files` returns 404 for deleted projects.
- `GET /projects/:projectId/files` — `{ items }` with exactly the three files. Each:

```json
{
  "ownerUid": "uid123",
  "path": "index.html",
  "content": "<!DOCTYPE html>...",
  "size": 379,
  "sha256": "a1b2c3...64 hex chars",
  "updatedAt": { "_seconds": 1755900000, "_nanoseconds": 0 },
  "updatedBy": "seed"
}
```

Feed `content` by `path` into the editor and `previewBuilder`. `updatedBy` is one of `seed | user | restore | llm` — useful for a "last changed by" badge.

- `GET /projects/:projectId/snapshots?limit=20` — version history, newest first (see §9 for the shape).

**Live alternative** (recommended once the workspace is interactive, since the mock send writes files client-side and other tabs should converge):

```ts
import { collection, doc, onSnapshot } from 'firebase/firestore'

onSnapshot(doc(firestore, 'projects', pid), (snap) => { /* name, headSnapshotId, status */ })
onSnapshot(collection(firestore, 'projects', pid, 'files'), (snap) => {
  const files = snap.docs.map((d) => d.data()) // same FileDoc shape, real Timestamps
})
```

Store the selected `projectId` in the router path (`/p/:projectId`), not only in the Pinia store, so a refresh re-selects it. On load, `GET /projects/:projectId` doubles as the ownership/existence check: 403/404 → redirect to the list.

---

## 8. Scenario: mock "send" — writing the seed files and snapshotting

This is the LLM stand-in. On **every** chat send, the frontend pushes the fixed seed tree (`stores/seedFiles.ts`) into the project's file docs and then asks the backend to snapshot. The result is exactly the Firestore state a real generation would leave behind: updated `files/*`, content-addressed `blobs/*`, a new snapshot manifest, and `headSnapshotId` advanced.

**There is no REST/callable endpoint for writing file content.** The one and only client write path is a Firestore `updateDoc` on the file docs, which rules permit under strict conditions:

- **Update only** — the three docs already exist (seeded at creation); `create`/`delete` are denied. Use `updateDoc`, never `setDoc` (a `setDoc` on a missing doc would be a create and be denied; on an existing doc a plain `setDoc` would drop `ownerUid`).
- `path` must not change, `updatedBy` must be exactly `'user'`, `content` ≤ 100 000 chars.
- Doc id is `fileId(path)` — base64url of the path (§2.4): `index.html → aW5kZXguaHRtbA`, `app.js → YXBwLmpz`, `styles.css → c3R5bGVzLmNzcw`.

### The full send sequence

```ts
import { addDoc, collection, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions, firebaseAuth } from '@/lib/firebase'
import { byteSize, fileId, sha256hex } from '@/lib/content'
import { seedFiles } from '@/stores/seedFiles'

const saveSnapshot = httpsCallable<
  { projectId: string; label?: string | null },
  { snapshotId: string }
>(functions, 'saveSnapshot')

export async function mockSend(projectId: string, prompt: string): Promise<string> {
  const uid = firebaseAuth.currentUser!.uid

  // 1. Record the chat message (optional — UI history only; the backend
  //    doesn't read messages yet. Rules require role 'user', ≤ 4000 chars).
  await addDoc(collection(firestore, 'projects', projectId, 'messages'), {
    ownerUid: uid,
    role: 'user',
    content: prompt.slice(0, 4000),
    createdAt: serverTimestamp(),
  })

  // 2. Write all three seed files in ONE batch (atomic — never a half-updated tree).
  const batch = writeBatch(firestore)
  for (const f of seedFiles) {
    batch.update(doc(firestore, 'projects', projectId, 'files', fileId(f.path)), {
      content: f.content,
      size: byteSize(f.content),
      sha256: await sha256hex(f.content),
      updatedAt: serverTimestamp(),
      updatedBy: 'user', // rules reject anything else from the client
    })
  }
  await batch.commit()

  // 3. Snapshot the working tree server-side: writes blobs (content-addressed,
  //    skipped if already present), creates the manifest, advances headSnapshotId.
  const { data } = await saveSnapshot({ projectId, label: prompt.slice(0, 80) })

  // 4. Rebuild the preview from seedFiles / the onSnapshot-refreshed store.
  return data.snapshotId
}
```

Notes and edge cases:

- **`sha256`/`size` must be computed, never copied or guessed** — `saveSnapshot` uses the file doc's `sha256` as the blob document id. Rules can't validate the hash, so a wrong value corrupts version history silently.
- Sending the identical seed tree repeatedly is **cheap and safe**: blobs are content-addressed, so the second and later sends create no new blobs — only a new snapshot manifest pointing at the existing ones. Snapshots do accumulate one per send; if you want a tidier history, compare the seed hashes against the current head manifest and skip `saveSnapshot` when nothing changed (the backend does this dedup on *restore*, not on save).
- Using the label to carry the prompt (≤ 80 chars, or `null`) makes the history readable: each version shows what "generated" it.
- `saveSnapshot` responds 404 if the project is deleted, 422 if the project somehow has no files. REST equivalent: `POST /projects/:projectId/snapshots` with `{ label? }` → 201 `{ snapshotId }`.
- When real generation ships, this whole function collapses into one `POST /generate` SSE call — keep it isolated in a single store action so the swap is one file.

---

## 9. Scenario: version history and restore

### 9.1 List snapshots

`GET /projects/:projectId/snapshots?limit=20` → `{ items }`, newest first:

```json
{
  "id": "01J5ZK3M9QWERTYUIOPASDFGHJ",
  "ownerUid": "uid123",
  "createdAt": { "_seconds": 1755990000, "_nanoseconds": 0 },
  "trigger": "manual",
  "generationId": null,
  "restoredFrom": null,
  "label": "make the dashboard blue",
  "files": [
    { "path": "index.html", "sha256": "a1b2...", "size": 2048 },
    { "path": "app.js",     "sha256": "c3d4...", "size": 1024 },
    { "path": "styles.css", "sha256": "e5f6...", "size": 512 }
  ]
}
```

`trigger` values: `seed` (project creation), `manual` (your mock sends / explicit saves), `restore` (created by a restore), `generation` (future LLM). Snapshots hold **manifests only** — hashes, not content — so this list is light. Mark the entry whose `id` equals the project's `headSnapshotId` as "Current".

### 9.2 Restore a snapshot

```ts
const restoreSnapshot = httpsCallable<
  { projectId: string; snapshotId: string },
  { snapshotId: string; restored: boolean }
>(functions, 'restoreSnapshot')

const { data } = await restoreSnapshot({ projectId, snapshotId })
```

Semantics to reflect in the UI:

- Restore **never rewinds history** — it copies the target snapshot's content into the working files and creates a **new** snapshot (`trigger: 'restore'`, `restoredFrom: <target id>`) which becomes the head. The returned `snapshotId` is that new head, not the one you passed.
- `restored: false` means the working tree already matched the target — nothing changed and no new snapshot was made. Show "Already on this version".
- After a successful restore, re-fetch files and snapshots (or let the `onSnapshot` listeners deliver the change).
- Errors: 404 (project deleted or snapshot id unknown), 409 `GENERATION_IN_FLIGHT` (future), 422 (`snapshotId` must be a 26-char ULID). REST: `POST /projects/:projectId/snapshots/:snapshotId/restore`.

---

## 10. Firestore rules cheat sheet (what the client may touch directly)

| Path | Read | Write |
|---|---|---|
| `users/{uid}` | own doc | create/update own doc (backend profile flow preferred) |
| `projects/{pid}` | owner | update allowed but **use the API instead**; `headSnapshotId`/`activeGenerationId` are always rejected; direct *create* makes a broken project — never do it |
| `projects/{pid}/files/{fid}` | owner | **update only**, `updatedBy: 'user'`, path immutable, content ≤ 100k — this is the mock-send path |
| `projects/{pid}/messages/{mid}` | owner | create only, `role: 'user'`, ≤ 4000 chars |
| `projects/{pid}/blobs`, `/snapshots`, `/generations` | owner (read) | never |
| `hlConnections`, `oauthStates`, `rateLimits`, `cancellations` | never | never |

---

## 11. API reference

REST base: see §2.2. All routes require `Authorization: Bearer <idToken>`.

| Method & path | Body / query | Success | Callable twin |
|---|---|---|---|
| `GET /healthz` | — | `{ ok: true }` (no auth) | — |
| `POST /users/profile` | `{ displayName? }` | 201 `{ created: true }` / 200 `{ created: false }` | `createUserProfile` |
| `GET /users/me` | — | profile doc (§5) | — |
| `POST /projects` | `{ name, description? }` | 201 `{ projectId, snapshotId }` | `createProject` |
| `GET /projects` | `?status=active\|deleted&limit=1..100` | `{ items: Project[] }` | — |
| `GET /projects/:pid` | — | `Project` | — |
| `PATCH /projects/:pid` | `{ name?, description? }` (≥ 1) | `{ projectId }` | `renameProject` (+`projectId` in data) |
| `DELETE /projects/:pid` | — | `{ projectId, status: 'deleted' }` | `softDeleteProject` |
| `POST /projects/:pid/restore` | — | `{ projectId, status: 'active' }` | `restoreProject` |
| `GET /projects/:pid/files` | — | `{ items: FileDoc[] }` | — |
| `GET /projects/:pid/snapshots` | `?limit=1..100` | `{ items: Snapshot[] }` | — |
| `POST /projects/:pid/snapshots` | `{ label? }` | 201 `{ snapshotId }` | `saveSnapshot` (+`projectId`) |
| `POST /projects/:pid/snapshots/:sid/restore` | — | `{ snapshotId, restored }` | `restoreSnapshot` (+both ids) |

All request bodies are validated with **strict** schemas — unknown keys are a 422, so don't spread whole store objects into request payloads.

Interactive OpenAPI docs are served by the same function at `<API_BASE>/docs`.
