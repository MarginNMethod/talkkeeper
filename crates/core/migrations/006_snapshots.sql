CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    captured_at TEXT NOT NULL,
    elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms >= 0),
    source TEXT NOT NULL,
    use_in_summary INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX snapshots_note ON snapshots(note_id, captured_at);
