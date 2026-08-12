# SyncMesh

**Real-time GunDB sync + tiered storage for chat and file-heavy apps.**

SyncMesh keeps a bounded, real-time "hot" window of chat messages in
[GunDB](https://gun.eco), archives everything older to
[Cloudflare R2](https://developers.cloudflare.com/r2/) as write-once JSON,
and indexes those archives in a metadata database of your choice —
**D1, MongoDB, MySQL, or PostgreSQL** — so your GunDB relay never runs out
of RAM no matter how long a chat history gets. It also gives you
presigned, direct-to-R2 multipart file uploads out of the box.

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
a **rolling window per room**: once a room's live message count crosses
`room.hotWindow`, the oldest overflow is archived to R2, indexed, and
*then* nulled out of Gun — keeping the live content footprint flat over
time instead of growing forever.

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

1. **Spin up a relay** (in production, deploy this as its own always-on service):
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
