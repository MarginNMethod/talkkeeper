CREATE TABLE calendar_sources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
 enabled INTEGER NOT NULL, sync_minutes INTEGER NOT NULL CHECK(sync_minutes BETWEEN 5 AND 120),
 last_synced_at TEXT, last_error TEXT, etag TEXT, last_modified TEXT
);
CREATE TABLE calendar_events (
 source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
 uid TEXT NOT NULL, instance_start TEXT NOT NULL, instance_end TEXT NOT NULL,
 all_day INTEGER NOT NULL, title TEXT NOT NULL, location TEXT NOT NULL,
 description TEXT NOT NULL, organizer TEXT NOT NULL, attendees TEXT NOT NULL,
 meeting_url TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(source_id,uid,instance_start)
);
CREATE TABLE calendar_note_links (
 note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
 uid TEXT NOT NULL, instance_start TEXT NOT NULL,
 UNIQUE(source_id,uid,instance_start)
);
