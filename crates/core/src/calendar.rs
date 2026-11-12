//! Local calendar cache. Private subscription addresses never enter this module.
use crate::*;
use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarSource {
    pub id: String,
    pub name: String,
    pub color: String,
    pub enabled: bool,
    pub sync_minutes: u32,
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub source_id: String,
    pub uid: String,
    pub instance_start: DateTime<Utc>,
    pub instance_end: DateTime<Utc>,
    pub all_day: bool,
    pub title: String,
    pub location: String,
    pub description: String,
    pub organizer: String,
    pub attendees: Vec<Attendee>,
    pub meeting_url: Option<String>,
    pub status: String,
}
impl Store {
    pub fn save_calendar_source(&mut self, s: &CalendarSource) -> Result<()> {
        if !(5..=120).contains(&s.sync_minutes) {
            return Err(Error::Invalid("refresh interval must be 5–120 minutes"));
        }
        self.conn.execute("INSERT INTO calendar_sources VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,enabled=excluded.enabled,sync_minutes=excluded.sync_minutes,last_synced_at=excluded.last_synced_at,last_error=excluded.last_error,etag=excluded.etag,last_modified=excluded.last_modified", params![s.id,s.name,s.color,s.enabled,s.sync_minutes,s.last_synced_at,s.last_error,s.etag,s.last_modified])?;
        Ok(())
    }
    pub fn calendar_sources(&self) -> Result<Vec<CalendarSource>> {
        let mut q = self
            .conn
            .prepare("SELECT * FROM calendar_sources ORDER BY name,id")?;
        let rows = q.query_map([], |r| {
            Ok(CalendarSource {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                enabled: r.get(3)?,
                sync_minutes: r.get(4)?,
                last_synced_at: r.get(5)?,
                last_error: r.get(6)?,
                etag: r.get(7)?,
                last_modified: r.get(8)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }
    pub fn remove_calendar_source(&mut self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM calendar_sources WHERE id=?", [id])?;
        Ok(())
    }
    pub fn replace_calendar_events(&mut self, id: &str, events: &[CalendarEvent]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM calendar_events WHERE source_id=?", [id])?;
        for e in events {
            if e.source_id != id {
                return Err(Error::Invalid("calendar source mismatch"));
            }
            tx.execute(
                "INSERT INTO calendar_events VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    id,
                    e.uid,
                    e.instance_start.to_rfc3339(),
                    e.instance_end.to_rfc3339(),
                    e.all_day,
                    e.title,
                    e.location,
                    e.description,
                    e.organizer,
                    serde_json::to_string(&e.attendees)?,
                    e.meeting_url,
                    e.status,
                    Utc::now().to_rfc3339()
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn calendar_events(&self) -> Result<Vec<CalendarEvent>> {
        self.read_calendar_events(true)
    }
    fn read_calendar_events(&self, enabled_only: bool) -> Result<Vec<CalendarEvent>> {
        let sql = if enabled_only {
            "SELECT e.* FROM calendar_events e JOIN calendar_sources s ON s.id=e.source_id WHERE s.enabled=1 AND e.status!='CANCELLED' ORDER BY instance_start,uid"
        } else {
            "SELECT * FROM calendar_events ORDER BY instance_start,uid"
        };
        let mut q = self.conn.prepare(sql)?;
        let rows = q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, bool>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, String>(11)?,
            ))
        })?;
        rows.map(|r| {
            let (
                source_id,
                uid,
                start,
                end,
                all_day,
                title,
                location,
                description,
                organizer,
                attendees,
                meeting_url,
                status,
            ) = r?;
            Ok(CalendarEvent {
                source_id,
                uid,
                instance_start: DateTime::parse_from_rfc3339(&start)
                    .map_err(|_| Error::Invalid("invalid event time"))?
                    .with_timezone(&Utc),
                instance_end: DateTime::parse_from_rfc3339(&end)
                    .map_err(|_| Error::Invalid("invalid event time"))?
                    .with_timezone(&Utc),
                all_day,
                title,
                location,
                description,
                organizer,
                attendees: serde_json::from_str(&attendees)?,
                meeting_url,
                status,
            })
        })
        .collect()
    }
    /// Only the returned copy is changed; local notes retain their calendar metadata.
    pub fn calendar_safe_note(&self, mut note: Note, allow_details: bool) -> Result<Note> {
        let linked: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM calendar_note_links WHERE note_id=?)",
            [note.id.to_string()],
            |r| r.get(0),
        )?;
        if linked && !allow_details {
            note.title = "Meeting notes".into();
            note.attendees.clear();
        }
        Ok(note)
    }
    pub fn note_calendar_event(&self, id: Uuid) -> Result<Option<CalendarEvent>> {
        let key: Option<(String, String, String)> = self
            .conn
            .query_row(
                "SELECT source_id,uid,instance_start FROM calendar_note_links WHERE note_id=?",
                [id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((s, u, t)) = key else {
            return Ok(None);
        };
        Ok(self
            .read_calendar_events(false)?
            .into_iter()
            .find(|e| e.source_id == s && e.uid == u && e.instance_start.to_rfc3339() == t))
    }
    pub fn calendar_note(&self, e: &CalendarEvent) -> Result<Option<Note>> {
        let id:Option<String>=self.conn.query_row("SELECT note_id FROM calendar_note_links WHERE source_id=? AND uid=? AND instance_start=?",params![e.source_id,e.uid,e.instance_start.to_rfc3339()],|r|r.get(0)).optional()?;
        id.map(|id| {
            self.get_note(Uuid::parse_str(&id).map_err(|_| Error::Invalid("invalid note id"))?)
        })
        .transpose()
        .map(Option::flatten)
    }
    pub fn link_calendar_note(&mut self, note_id: Uuid, e: &CalendarEvent) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO calendar_note_links VALUES (?1,?2,?3,?4)",
            params![
                note_id.to_string(),
                e.source_id,
                e.uid,
                e.instance_start.to_rfc3339()
            ],
        )?;
        Ok(())
    }
    pub fn start_calendar_note(&mut self, e: &CalendarEvent) -> Result<Note> {
        if let Some(n) = self.calendar_note(e)? {
            return Ok(n);
        }
        let mut n = Note::new(&e.title);
        n.attendees = e.attendees.clone();
        self.create_note(&n)?;
        self.link_calendar_note(n.id, e)?;
        Ok(n)
    }
}
