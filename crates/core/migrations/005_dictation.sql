CREATE TABLE dictation_history (id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX dictation_history_date ON dictation_history(created_at DESC);
