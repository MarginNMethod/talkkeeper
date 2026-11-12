CREATE TABLE chat_messages (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL, proposed_edit_id TEXT, revision TEXT);
CREATE TABLE summary_versions (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, content TEXT, created_at TEXT NOT NULL);
CREATE VIRTUAL TABLE segment_search USING fts5(segment_id UNINDEXED, note_id UNINDEXED, text);
INSERT INTO segment_search SELECT id, note_id, json_extract(data, '$.text') FROM segments;
CREATE TRIGGER segment_search_insert AFTER INSERT ON segments BEGIN
 INSERT INTO segment_search VALUES (new.id,new.note_id,json_extract(new.data,'$.text'));
END;
CREATE TRIGGER segment_search_delete AFTER DELETE ON segments BEGIN
 DELETE FROM segment_search WHERE segment_id=old.id;
END;
CREATE TRIGGER segment_search_update AFTER UPDATE ON segments BEGIN
 DELETE FROM segment_search WHERE segment_id=old.id;
 INSERT INTO segment_search VALUES (new.id,new.note_id,json_extract(new.data,'$.text'));
END;
