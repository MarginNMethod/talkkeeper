use crate::*;
use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Serialize};
use std::{io::Write, path::Path, time::Duration};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Csv(#[from] csv::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("record not found")]
    NotFound,
    #[error("invalid operation: {0}")]
    Invalid(&'static str),
}

pub struct Store {
    pub(crate) conn: Connection,
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::initialize(Connection::open(path)?)
    }
    pub fn open_in_memory() -> Result<Self> {
        Self::initialize(Connection::open_in_memory()?)
    }
    fn initialize(mut conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")?;
        let tx = conn.transaction()?;
        let version: i64 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > 2 {
            return Err(Error::Invalid(
                "database schema is newer than this application",
            ));
        }
        if version == 0 {
            tx.execute_batch(include_str!("../migrations/001_initial.sql"))?;
            tx.pragma_update(None, "user_version", 1)?;
        }
        if version < 2 {
            tx.execute_batch(include_str!("../migrations/002_workspace.sql"))?;
            tx.pragma_update(None, "user_version", 2)?;
            rebuild_search(&tx)?;
        }
        tx.commit()?;
        Ok(Self { conn })
    }
    fn write<T>(&mut self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let tx = self.conn.transaction()?;
        let result = f(&tx)?;
        rebuild_search(&tx)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn create_note(&mut self, note: &Note) -> Result<()> {
        self.write(|tx| {
            tx.execute(
                "INSERT INTO notes VALUES (?1,?2,?3)",
                params![
                    note.id.to_string(),
                    encode(note)?,
                    note.folder_id.map(|id| id.to_string())
                ],
            )?;
            Ok(())
        })
    }
    pub fn get_note(&self, id: Uuid) -> Result<Option<Note>> {
        get_note(&self.conn, id)
    }
    pub fn list_notes(&self) -> Result<Vec<Note>> {
        Ok(all_notes(&self.conn)?
            .into_iter()
            .filter(|n| n.deleted_at.is_none())
            .collect())
    }
    pub fn list_trash(&self) -> Result<Vec<Note>> {
        Ok(all_notes(&self.conn)?
            .into_iter()
            .filter(|n| n.deleted_at.is_some())
            .collect())
    }
    pub fn update_note(&mut self, note: &Note) -> Result<()> {
        self.write(|tx| {
            let old = get_note(tx, note.id)?.ok_or(Error::NotFound)?;
            let mut updated = note.clone();
            updated.created_at = old.created_at;
            updated.deleted_at = old.deleted_at;
            updated.updated_at = Utc::now();
            save_note(tx, &updated)
        })
    }
    pub fn trash_note(&mut self, id: Uuid) -> Result<()> {
        self.set_trash(id, Some(Utc::now()))
    }
    pub fn restore_note(&mut self, id: Uuid) -> Result<()> {
        self.set_trash(id, None)
    }
    fn set_trash(&mut self, id: Uuid, time: Option<chrono::DateTime<Utc>>) -> Result<()> {
        self.write(|tx| {
            let mut n = get_note(tx, id)?.ok_or(Error::NotFound)?;
            n.deleted_at = time;
            n.updated_at = Utc::now();
            save_note(tx, &n)
        })
    }
    /// Permanently deletes a note and its transcript, including active notes.
    pub fn purge_note(&mut self, id: Uuid) -> Result<()> {
        self.write(|tx| {
            if tx.execute("DELETE FROM notes WHERE id=?", [id.to_string()])? == 0 {
                return Err(Error::NotFound);
            }
            Ok(())
        })
    }
    pub fn purge_trash_older_than(&mut self, age: Duration) -> Result<usize> {
        let cutoff = Utc::now()
            .checked_sub_signed(
                ChronoDuration::from_std(age).map_err(|_| Error::Invalid("duration too large"))?,
            )
            .ok_or(Error::Invalid("duration too large"))?;
        self.write(|tx| {
            let mut count = 0;
            for n in all_notes(tx)? {
                if n.deleted_at.is_some_and(|t| t < cutoff) {
                    count += tx.execute("DELETE FROM notes WHERE id=?", [n.id.to_string()])?;
                }
            }
            Ok(count)
        })
    }
    pub fn append_transcript_segments(&mut self, segments: &[TranscriptSegment]) -> Result<()> {
        self.write(|tx| {
            for s in segments {
                if s.end_ms < s.start_ms || s.seq > i64::MAX as u64 {
                    return Err(Error::Invalid("invalid segment range or sequence"));
                }
                tx.execute(
                    "INSERT INTO segments VALUES (?1,?2,?3,?4,?5)",
                    params![
                        s.id.to_string(),
                        s.note_id.to_string(),
                        s.seq,
                        s.created_at.to_rfc3339(),
                        encode(s)?
                    ],
                )?;
            }
            Ok(())
        })
    }
    pub fn list_transcript_segments(&self, note_id: Uuid) -> Result<Vec<TranscriptSegment>> {
        segments(&self.conn, note_id)
    }
    pub fn delete_transcript_segments(&mut self, note_id: Uuid, ids: &[Uuid]) -> Result<usize> {
        self.write(|tx| {
            let mut n = 0;
            for id in ids {
                n += tx.execute(
                    "DELETE FROM segments WHERE note_id=? AND id=?",
                    params![note_id.to_string(), id.to_string()],
                )?;
            }
            Ok(n)
        })
    }
    /// Deletes an inclusive sequence range.
    pub fn delete_transcript_range(
        &mut self,
        note_id: Uuid,
        first: u64,
        last: u64,
    ) -> Result<usize> {
        if first > last || last > i64::MAX as u64 {
            return Err(Error::Invalid("invalid sequence range"));
        }
        self.write(|tx| {
            Ok(tx.execute(
                "DELETE FROM segments WHERE note_id=? AND seq BETWEEN ? AND ?",
                params![note_id.to_string(), first, last],
            )?)
        })
    }
    pub fn apply_transcript_retention(&mut self, days: u32) -> Result<usize> {
        let cutoff = Utc::now() - ChronoDuration::days(i64::from(days));
        self.write(|tx| {
            let mut count = 0;
            for note in all_notes(tx)? {
                for s in segments(tx, note.id)? {
                    if s.created_at < cutoff {
                        count +=
                            tx.execute("DELETE FROM segments WHERE id=?", [s.id.to_string()])?;
                    }
                }
            }
            Ok(count)
        })
    }
    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,name,parent_id FROM folders ORDER BY name,id")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })?;
        rows.map(|row| {
            let (id, name, parent) = row?;
            Ok(Folder {
                id: parse_id(&id)?,
                name,
                parent_id: parent.map(|s| parse_id(&s)).transpose()?,
            })
        })
        .collect()
    }
    pub fn create_folder(&mut self, folder: &Folder) -> Result<()> {
        self.save_folder(folder, false)
    }
    pub fn update_folder(&mut self, folder: &Folder) -> Result<()> {
        self.save_folder(folder, true)
    }
    fn save_folder(&mut self, folder: &Folder, update: bool) -> Result<()> {
        self.write(|tx| {
            if let Some(parent) = folder.parent_id {
                if parent == folder.id {
                    return Err(Error::Invalid("folder cannot parent itself"));
                }
                let ancestor: Option<Option<String>> = tx
                    .query_row(
                        "SELECT parent_id FROM folders WHERE id=?",
                        [parent.to_string()],
                        |r| r.get(0),
                    )
                    .optional()?;
                if ancestor != Some(None) {
                    return Err(Error::Invalid("parent must be a root folder"));
                }
                let children: i64 = tx.query_row(
                    "SELECT count(*) FROM folders WHERE parent_id=?",
                    [folder.id.to_string()],
                    |r| r.get(0),
                )?;
                if children > 0 {
                    return Err(Error::Invalid("folder with children must remain a root"));
                }
            }
            let sql = if update {
                "UPDATE folders SET name=?2,parent_id=?3 WHERE id=?1"
            } else {
                "INSERT INTO folders VALUES (?1,?2,?3)"
            };
            if tx.execute(
                sql,
                params![
                    folder.id.to_string(),
                    folder.name,
                    folder.parent_id.map(|id| id.to_string())
                ],
            )? == 0
            {
                return Err(Error::NotFound);
            }
            Ok(())
        })
    }
    /// Child folders must be removed or moved first. Notes become unfiled.
    pub fn delete_folder(&mut self, id: Uuid) -> Result<()> {
        self.write(|tx| {
            for mut n in all_notes(tx)? {
                if n.folder_id == Some(id) {
                    n.folder_id = None;
                    save_note(tx, &n)?;
                }
            }
            if tx.execute("DELETE FROM folders WHERE id=?", [id.to_string()])? == 0 {
                return Err(Error::NotFound);
            }
            Ok(())
        })
    }
    pub fn list_vocabulary(&self) -> Result<Vec<VocabularyTerm>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,term FROM vocabulary ORDER BY term,id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.map(|r| {
            let (id, term) = r?;
            Ok(VocabularyTerm {
                id: parse_id(&id)?,
                term,
            })
        })
        .collect()
    }
    pub fn create_vocabulary_term(&mut self, term: &VocabularyTerm) -> Result<()> {
        self.write(|tx| {
            let n: i64 = tx.query_row("SELECT count(*) FROM vocabulary", [], |r| r.get(0))?;
            if n >= 100 {
                return Err(Error::Invalid("vocabulary is limited to 100 terms"));
            }
            tx.execute(
                "INSERT INTO vocabulary VALUES (?,?)",
                params![term.id.to_string(), term.term],
            )?;
            Ok(())
        })
    }
    pub fn update_vocabulary_term(&mut self, term: &VocabularyTerm) -> Result<()> {
        self.write(|tx| {
            if tx.execute(
                "UPDATE vocabulary SET term=? WHERE id=?",
                params![term.term, term.id.to_string()],
            )? == 0
            {
                return Err(Error::NotFound);
            }
            Ok(())
        })
    }
    pub fn delete_vocabulary_term(&mut self, id: Uuid) -> Result<()> {
        self.write(|tx| {
            if tx.execute("DELETE FROM vocabulary WHERE id=?", [id.to_string()])? == 0 {
                return Err(Error::NotFound);
            }
            Ok(())
        })
    }
    /// Store non-secret preferences only; callers must use the OS keychain for credentials.
    pub fn set_setting(&mut self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.write(|tx| {tx.execute("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,encode(value)?])?; Ok(())})
    }
    pub fn get_setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let s: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key=?", [key], |r| {
                r.get(0)
            })
            .optional()?;
        s.map(|s| decode(&s)).transpose()
    }
    pub fn search(
        &self,
        query: &str,
        filters: &SearchFilters,
        limit: usize,
    ) -> Result<Vec<SearchHit>> {
        let mut stmt=self.conn.prepare("SELECT note_id,snippet(note_search,-1,'[',']',' … ',24),bm25(note_search) FROM note_search WHERE note_search MATCH ? ORDER BY bm25(note_search),note_id")?;
        let rows = stmt.query_map([query], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
            ))
        })?;
        let mut hits = Vec::new();
        for row in rows {
            if hits.len() >= limit {
                break;
            }
            let (id, snippet, rank) = row?;
            let note = get_note(&self.conn, parse_id(&id)?)?.ok_or(Error::NotFound)?;
            if filters
                .folder_id
                .is_some_and(|id| note.folder_id != Some(id))
                || filters.date_from.is_some_and(|d| note.created_at < d)
                || filters.date_to.is_some_and(|d| note.created_at > d)
            {
                continue;
            }
            if let Some(a) = &filters.attendee {
                let a = a.to_lowercase();
                if !note.attendees.iter().any(|p| {
                    p.name.to_lowercase().contains(&a) || p.email.to_lowercase().contains(&a)
                }) {
                    continue;
                }
            }
            hits.push(SearchHit {
                note,
                snippet,
                rank,
            });
        }
        Ok(hits)
    }
    pub fn export_transcript_text(&self, id: Uuid) -> Result<String> {
        self.get_note(id)?.ok_or(Error::NotFound)?;
        Ok(segments(&self.conn, id)?
            .iter()
            .map(|s| {
                format!(
                    "[{:02}:{:02}] {}: {}\n",
                    s.start_ms / 60000,
                    (s.start_ms / 1000) % 60,
                    s.speaker,
                    s.text
                )
            })
            .collect())
    }
    pub fn export_note_markdown(&self, id: Uuid) -> Result<String> {
        self.export_note_markdown_with_transcript(id, true)
    }
    pub fn export_note_markdown_with_transcript(
        &self,
        id: Uuid,
        include_transcript: bool,
    ) -> Result<String> {
        let n = self.get_note(id)?.ok_or(Error::NotFound)?;
        let date = n.started_at.unwrap_or(n.created_at).to_rfc3339();
        let mut out = format!(
            "# {}\n\nDate: {}\n\nAttendees: {}\n",
            n.title,
            date,
            attendees(&n)
        );
        if let Some(summary) = n.summary_markdown {
            out.push_str(&format!("\n## Summary\n\n{summary}\n"));
        }
        out.push_str(&format!("\n## Your notes\n\n{}\n", n.notes_markdown));
        if include_transcript {
            let transcript = self.export_transcript_text(id)?;
            if !transcript.is_empty() {
                out.push_str(&format!("\n## Transcript\n\n{transcript}"));
            }
        }
        Ok(out)
    }
    /// Exports active notes; trashed notes are excluded.
    pub fn export_all_csv(&self, writer: impl Write) -> Result<()> {
        let mut csv = csv::Writer::from_writer(writer);
        csv.write_record([
            "id",
            "title",
            "started_at",
            "attendees",
            "summary",
            "notes",
            "transcript",
        ])?;
        for n in self.list_notes()? {
            csv.write_record([
                n.id.to_string(),
                n.title.clone(),
                n.started_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
                attendees(&n),
                n.summary_markdown.clone().unwrap_or_default(),
                n.notes_markdown.clone(),
                self.export_transcript_text(n.id)?,
            ])?;
        }
        csv.flush()?;
        Ok(())
    }
}
fn encode(v: &impl Serialize) -> Result<String> {
    Ok(serde_json::to_string(v)?)
}
fn decode<T: DeserializeOwned>(s: &str) -> Result<T> {
    Ok(serde_json::from_str(s)?)
}
fn parse_id(s: &str) -> Result<Uuid> {
    Uuid::parse_str(s).map_err(|_| Error::Invalid("invalid stored UUID"))
}
fn get_note(conn: &Connection, id: Uuid) -> Result<Option<Note>> {
    let s: Option<String> = conn
        .query_row("SELECT data FROM notes WHERE id=?", [id.to_string()], |r| {
            r.get(0)
        })
        .optional()?;
    s.map(|s| decode(&s)).transpose()
}
fn all_notes(conn: &Connection) -> Result<Vec<Note>> {
    let mut stmt =
        conn.prepare("SELECT data FROM notes ORDER BY json_extract(data,'$.created_at') DESC,id")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.map(|s| decode(&s?)).collect()
}
fn save_note(tx: &Transaction<'_>, n: &Note) -> Result<()> {
    tx.execute(
        "UPDATE notes SET data=?,folder_id=? WHERE id=?",
        params![
            encode(n)?,
            n.folder_id.map(|id| id.to_string()),
            n.id.to_string()
        ],
    )?;
    Ok(())
}
fn segments(conn: &Connection, id: Uuid) -> Result<Vec<TranscriptSegment>> {
    let mut stmt = conn.prepare("SELECT data FROM segments WHERE note_id=? ORDER BY seq,id")?;
    let rows = stmt.query_map([id.to_string()], |r| r.get::<_, String>(0))?;
    rows.map(|s| decode(&s?)).collect()
}
fn attendees(n: &Note) -> String {
    n.attendees
        .iter()
        .map(|a| format!("{} <{}>", a.name, a.email))
        .collect::<Vec<_>>()
        .join(", ")
}
fn rebuild_search(tx: &Transaction<'_>) -> Result<()> {
    tx.execute("DELETE FROM note_search", [])?;
    tx.execute("DELETE FROM workspace_search", [])?;
    for n in all_notes(tx)?
        .into_iter()
        .filter(|n| n.deleted_at.is_none())
    {
        for s in segments(tx, n.id)? {
            tx.execute(
                "INSERT INTO workspace_search VALUES (?,?,?,?,?)",
                params![n.id.to_string(), s.seq, s.start_ms, n.title, s.text],
            )?;
        }
        for section in format!(
            "{}\n{}",
            n.notes_markdown,
            n.summary_markdown.as_deref().unwrap_or("")
        )
        .split("\n\n")
        .filter(|s| !s.trim().is_empty())
        {
            tx.execute(
                "INSERT INTO workspace_search VALUES (?,?,?,?,?)",
                params![n.id.to_string(), 0, 0, n.title, section],
            )?;
        }
        let transcript = segments(tx, n.id)?
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        tx.execute(
            "INSERT INTO note_search VALUES (?,?,?,?,?,?)",
            params![
                n.id.to_string(),
                n.title,
                n.notes_markdown,
                n.summary_markdown,
                transcript,
                attendees(&n)
            ],
        )?;
    }
    Ok(())
}
