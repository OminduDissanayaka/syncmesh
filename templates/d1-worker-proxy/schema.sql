-- SyncMesh D1 schema (only relevant when db.provider = "d1")
-- Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
--
-- Optional: SyncMesh's D1Adapter already runs the equivalent
-- CREATE TABLE IF NOT EXISTS statements via mesh.init(). Run this
-- manually only if you want the schema in place before the app ever
-- boots (e.g. as part of a CI/CD pipeline).

CREATE TABLE IF NOT EXISTS optimized_files (
    file_id TEXT PRIMARY KEY,
    file_name TEXT,
    file_type TEXT,
    file_size INTEGER,
    file_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_archive_chunks (
    chunk_id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    message_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunks_room_time
    ON chat_archive_chunks (room_id, start_ts, end_ts);
