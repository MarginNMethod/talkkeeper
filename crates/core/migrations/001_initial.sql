CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT);
CREATE TABLE notes (id TEXT PRIMARY KEY, data TEXT NOT NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL);
CREATE TABLE segments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, seq INTEGER NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(note_id, seq));
CREATE TABLE vocabulary (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE note_search USING fts5(note_id UNINDEXED, title, notes, summary, transcript, attendees);
