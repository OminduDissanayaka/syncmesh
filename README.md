# SyncMesh

**A real-time + cold-storage infrastructure layer.**

SyncMesh keeps a bounded, real-time "hot" window of events in
[GunDB](https://gun.eco), archives everything older to
[Cloudflare R2](https://developers.cloudflare.com/r2/) as write-once JSON,
and indexes those archives in a metadata database of your choice —
**D1, MongoDB, MySQL, or PostgreSQL** — so your GunDB relay never runs out
of RAM no matter how much history accumulates. It also gives you
presigned, direct-to-R2 multipart file uploads out of the box.

Chat is the flagship use case, but "room" in SyncMesh just means *any
stream, channel, or entity ID whose events should be bounded in RAM and
archived once they age out*. That covers a lot more than chat:

- Chat
- Comments
- Activity feeds
- Notifications
- Collaborative apps (cursors, presence, live edits)
- IoT event streams
- Audit logs
- Realtime documents

Architect: **Omindu Dissanayaka** — [github.com/OminduDissanayaka](https://github.com/OminduDissanayaka)

## Install

```bash
npm install syncmesh
```

Then install **one** metadata-DB driver, matching whichever provider you
choose (skip this for `d1`, which needs no extra package):

```bash
npm install mongodb   # or: mysql2   /   pg
```

## Why SyncMesh exists

GunDB has no true delete — nulling a node leaves a small tombstone in the
graph forever (required for distributed consistency). So "archive old data
then delete it" doesn't fully reclaim RAM on its own. SyncMesh's answer is
a **rolling window per room**: once a room's live event count crosses
`room.hotWindow`, the oldest overflow is archived to R2, indexed, and
*then* nulled out of Gun — keeping the live content footprint flat over
time instead of growing forever, whether "room" means a chat channel, a
notification feed, a device's event stream, or an audit log.

```
┌──────────────┐   Gun WebSocket   ┌───────────────────┐
│  Your app     │◄─────────────────►│  GunDB relay        │
│  (SyncMesh)   │                   │  npx syncmesh-relay   │
└──────┬───────┘                   └───────────────────┘
       │
       ├──► Cloudflare R2 (file blobs + write-once chat-archive JSON chunks)
       │
       └──► Metadata DB — d1 | mongodb | mysql | postgres (your pick)
```

## Quick start

```js
const { SyncMesh } = require('syncmesh');

const mesh = new SyncMesh({
  gunPeerUrl: 'https://your-relay.example.com/gun',
  r2: {
    accountId: process.env.CF_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
  },
  db: {
    provider: 'mongodb', // 'd1' | 'mongodb' | 'mysql' | 'postgres'
    uri: process.env.DB_URI,
  },
  room: { hotWindow: 300, archiveBatchSize: 150 }, // both optional
});

await mesh.init();
```

1. **Spin up a relay** (in production, deploy this as its own always-on service — it's a raw `http` server using Gun's own canonical relay pattern, no Express involved):
   ```bash
   npx syncmesh-relay
   # GunDB endpoint: http://localhost:8081/gun
   ```
2. **Write chat messages directly with Gun**, using the path convention SyncMesh expects (see "Data model" below).
3. **Call SyncMesh after each write** to keep the room bounded, and to read history:
   ```js
   await mesh.archiveRoomIfNeeded(roomId);
   const recent = await mesh.getHistory(roomId, { limit: 50 });
   ```

## Data model — how to write messages

SyncMesh's archiver reads whatever is under this Gun path, so write your
messages there:

```js
const Gun = require('gun');
const gun = Gun({ peers: ['https://your-relay.example.com/gun'] });

gun.get(`room:${roomId}`).get('messages').get(messageId).put({
  ts: Date.now(),      // required — numeric timestamp, used for ordering & archiving
  userId: '...',
  text: '...',
  // any other fields you want — they're preserved through archiving
});
```

Call `mesh.archiveRoomIfNeeded(roomId)` after each write (cheap no-op
unless the room just crossed `room.hotWindow`).

> The same pattern works for any event stream, not just chat: swap
> `roomId` for a `feedId`, `deviceId`, `documentId`, or `channelId`, and
> `text`/`userId` for whatever fields your event needs. The archiver only
> cares about the `ts` field and the Gun path convention above.

## Core API

```ts
new SyncMesh({ gunPeerUrl, r2, db, room? })

await mesh.init()                                    // connect DB + Gun
await mesh.close()                                    // release DB connections

// Chat
await mesh.archiveRoomIfNeeded(roomId)                 // -> { archived, chunkId?, count? }
await mesh.getHistory(roomId, { before?, limit? })      // -> Message[] (hot + cold, blended)

// Files (direct-to-R2 presigned multipart upload)
await mesh.startUpload({ fileId, fileName, fileType })   // -> { uploadId, fileKey }
await mesh.getUploadUrls({ fileKey, uploadId, parts })    // -> string[] (one presigned URL per part)
await mesh.completeUpload({ fileId, fileKey, uploadId, parts, fileName, fileType, fileSize })
await mesh.abortUpload({ fileKey, uploadId })
await mesh.getFile(fileId)                                // -> { metadata, downloadUrl } | null
```

Full client-side upload flow: `startUpload` → slice the file into 5MB
parts → `PUT` each part directly to its presigned URL from the browser →
`completeUpload` with the returned `ETag`s.

## Express integration (optional)

Only `syncmesh/express` and the example app need Express — the core
library and `syncmesh-relay` don't depend on it at all, so
`npm install express` only if you actually use this helper.

```js
const { createExpressRouter } = require('syncmesh/express');
app.use(createExpressRouter(mesh));
```

Mounts: `POST /start-upload`, `POST /get-upload-urls`,
`POST /complete-upload`, `POST /abort-upload`, `GET /file/:fileId`,
`GET /chat/:roomId/history`, `POST /chat/:roomId/archive-check`.

Not using Express? Call the `SyncMesh` methods directly from Fastify,
Koa, or a raw HTTP server — the router is just a thin convenience layer.

See a full working example in [`examples/express-app`](./examples/express-app).

## Choosing a metadata database

| `db.provider` | Runs where | Extra install | Config keys |
|---|---|---|---|
| `d1` | Only inside Cloudflare (via a Worker) | none | `proxyUrl`, `proxyToken` |
| `mongodb` | Anywhere Node.js runs | `npm install mongodb` | `uri`, `dbName?` |
| `mysql` | Anywhere Node.js runs | `npm install mysql2` | `uri` **or** `host`/`user`/`password`/`database`/`port` |
| `postgres` | Anywhere Node.js runs | `npm install pg` | `uri` **or** `host`/`user`/`password`/`database`/`port` |

Only the driver for your chosen provider is ever loaded — the other three
are never required into memory.

### `d1` needs one extra step

Cloudflare D1 has no external protocol; it can only be queried from
inside a Worker. Scaffold the bridge Worker with:

```bash
npx syncmesh-init-d1-proxy
cd d1-worker-proxy
npm install
npx wrangler d1 create syncmesh-db      # copy database_id into wrangler.toml
npm run db:init
npx wrangler secret put D1_PROXY_TOKEN
npm run deploy
```

Then configure SyncMesh with:
```js
db: { provider: 'd1', proxyUrl: 'https://syncmesh-d1-proxy.<subdomain>.workers.dev', proxyToken: '<same secret>' }
```

Every other provider connects straight from your app with no extra
service required.

## Writing a custom adapter

Only needed for a database not listed above (SQLite, Turso, DynamoDB…):

```js
const { BaseAdapter } = require('syncmesh/adapters/base');

class MyAdapter extends BaseAdapter {
  async init() { /* connect + ensure schema */ }
  async insertFileMetadata(file) { /* ... */ }
  async getFileMetadata(fileId) { /* ... */ }
  async insertChunkMetadata(chunk) { /* ... */ }
  async getChunksForRoom(roomId, beforeTs, limit) { /* ... */ }
  async close() { /* ... */ }
}

const mesh = new SyncMesh({
  gunPeerUrl: '...',
  r2: { /* ... */ },
  db: { adapter: new MyAdapter(/* ... */) },
});
```

All five methods are documented with JSDoc in
[`src/db/BaseAdapter.js`](./src/db/BaseAdapter.js).

## Security

**SyncMesh is infrastructure, not an auth system.** It has no concept of
users, sessions, or permissions — every method (`startUpload`,
`getUploadUrls`, `getHistory`, `archiveRoomIfNeeded`, `getFile`, etc.)
trusts whatever it's called with. Authentication and authorization are
entirely your API layer's responsibility, and skipping them is the most
common way to misuse SyncMesh. Before deploying, make sure your own code
covers every point below.

### 1. Never expose R2 credentials to the client

`accountId`, `accessKeyId`, `secretAccessKey` belong only in your
server-side SyncMesh config (env vars, secrets manager). Never ship them
in a client bundle, mobile app, or any API response. The entire point of
presigned URLs is that the client never needs these credentials — only
your server does, to *generate* the URLs.

### 2. Presigned URL expiration

`getUploadUrls()` and `getFile()`'s download URL both default to a
**1-hour expiry** (`expiresInSeconds` inside `R2Store`, currently fixed at
3600s and not yet exposed as a top-level `SyncMesh` option). For
sensitive or short-lived content, fork/extend `r2Client.js` to pass a
shorter expiry, and never log or persist presigned URLs — treat them as
short-lived bearer credentials, because that's exactly what they are.

### 3. File type validation

SyncMesh does **not** validate `fileType`. A client can send any MIME
type string it wants. Your API layer must allowlist acceptable types
before calling `startUpload()`, and ideally re-verify the *actual*
content after upload (magic-byte sniffing, a Cloudflare content-scanning
rule, or similar) — client-supplied MIME types are trivially spoofed.

### 4. File size limits

SyncMesh does not cap file size either. R2's own multipart limits (5MB
minimum per part except the last, 5GB max per part, 10,000 parts max) are
generous enough to let a client request an enormous number of parts if
nothing stops them. Enforce your own ceiling — reject `startUpload` /
`getUploadUrls` calls whose declared size or requested `parts` count
exceeds what your product actually needs.

### 5. Upload authorization

Anyone who can reach `getUploadUrls()` can get valid, working presigned
PUT URLs into **your** bucket — there's no built-in check that the caller
is even logged in, let alone allowed to upload in this context. If this
endpoint is unauthenticated, it's an open door for storage-cost abuse,
arbitrary file hosting through your bucket, or key collisions: since
`fileKey = uploads/{fileId}/{fileName}`, a caller who can supply an
arbitrary `fileId` they don't own can silently overwrite someone else's
upload at the same key. Require authentication before every upload call,
and verify the authenticated user actually owns `fileId` (e.g. check it
was allocated to them by your own backend, not client-supplied freely).

### 6. Room authorization

`getHistory(roomId)` and `archiveRoomIfNeeded(roomId)` return/operate on
whatever `roomId` they're given — there's no membership check. If your
API exposes these without verifying the caller belongs to that room,
anyone who can guess or enumerate room IDs can read full event history.
Check room membership in your own route handler before calling either
method.

### 7. `fileId` ownership

`getFile(fileId)` hands back a working download URL for *any* `fileId` —
it doesn't check who's asking. Store your own ownership/visibility
mapping for each `fileId` (e.g. "belongs to room X", "uploaded by user
Y") and check it before calling `getFile()`, not after.

### 8. Archive access control

The good news: archived chat/event chunks in R2 are only ever read
server-side inside `getHistory()` (via direct `GetObjectCommand`, not a
presigned URL) and returned to your API as plain JSON — SyncMesh never
hands a client a direct link into your archive chunks. So as long as you
enforce room authorization (#6) on your history endpoint, archive access
is protected for free. The risk is entirely upstream, at the room check.

### Recommended request flow

Put every SyncMesh call behind this order — skipping a layer is what
turns a working feature into an abuse vector:

```
Client request
      │
      ▼
Authentication     — who is this? (session, JWT, API key)
      │
      ▼
Authorization      — is this user allowed to do THIS action on THIS room/fileId?
      │
      ▼
Upload limits      — file type allowlist, size cap, rate limiting
      │
      ▼
SyncMesh           — startUpload / getUploadUrls / getHistory / getFile / ...
```

`createExpressRouter()` is a convenience layer for prototyping — it does
**none** of this. In production, either insert your own middleware in
front of it, or skip it and write your own thin routes that call
`SyncMesh` methods directly after your checks:

```js
app.post('/start-upload', requireAuth, async (req, res) => {
  const { fileId, fileName, fileType } = req.body;

  if (!ALLOWED_TYPES.includes(fileType)) {
    return res.status(415).json({ error: 'Unsupported file type' });
  }
  if (!(await userOwnsFileId(req.user.id, fileId))) {
    return res.status(403).json({ error: 'Not authorized for this fileId' });
  }

  const result = await mesh.startUpload({ fileId, fileName, fileType });
  res.status(200).json(result);
});
```

## Known limitations

- **Gun tombstones**: monitor your relay's actual RAM over weeks of
  production traffic, not just theory — tune `room.hotWindow` down if
  tombstone growth outpaces expectations for your message volume.
- **Archival race**: two concurrent `archiveRoomIfNeeded()` calls for the
  *same* room could double-batch under high concurrent write rates on a
  single room. Add your own per-room lock if that's a realistic scenario
  for you.
- **Settle-delay heuristic**: reading a room's live messages uses an
  800ms settle delay after `.map().once()`, not a guarantee every peer
  has responded — acceptable for archival (worst case: a message archives
  one cycle later), but tune it against your own peer latency if needed.

## License

MIT © [Omindu Dissanayaka](https://github.com/OminduDissanayaka)
