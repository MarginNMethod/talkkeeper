//! Snapshot files have generated names; callers cannot supply filesystem paths.
use crate::*;
use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

pub const SNAPSHOT_MAX_BYTES: usize = 1024 * 1024;
pub const SNAPSHOT_MAX_COUNT: usize = 60;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: Uuid,
    pub note_id: Uuid,
    pub captured_at: DateTime<Utc>,
    pub elapsed_ms: u64,
    pub source: String,
    pub use_in_summary: bool,
}
impl Store {
    fn snapshot_path(&self, id: Uuid) -> Result<PathBuf> {
        Ok(self
            .snapshot_directory
            .as_ref()
            .ok_or(Error::Invalid(
                "snapshot storage requires an on-disk database",
            ))?
            .join(format!("{id}.jpg")))
    }
    pub fn snapshots(&self, note_id: Uuid) -> Result<Vec<Snapshot>> {
        let mut statement = self.conn.prepare("SELECT id,captured_at,elapsed_ms,source,use_in_summary FROM snapshots WHERE note_id=? ORDER BY captured_at,id")?;
        let rows = statement.query_map([note_id.to_string()], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, bool>(4)?,
            ))
        })?;
        rows.map(|row| {
            let (id, date, elapsed_ms, source, use_in_summary) = row?;
            Ok(Snapshot {
                id: Uuid::parse_str(&id).map_err(|_| Error::Invalid("invalid snapshot id"))?,
                note_id,
                captured_at: DateTime::parse_from_rfc3339(&date)
                    .map_err(|_| Error::Invalid("invalid snapshot date"))?
                    .with_timezone(&Utc),
                elapsed_ms,
                source,
                use_in_summary,
            })
        })
        .collect()
    }
    pub fn add_snapshot(&mut self, snapshot: &Snapshot, jpeg: &[u8]) -> Result<()> {
        let note = self.get_note(snapshot.note_id)?.ok_or(Error::NotFound)?;
        if note.deleted_at.is_some()
            || jpeg.len() > SNAPSHOT_MAX_BYTES
            || !jpeg.starts_with(&[0xff, 0xd8])
            || snapshot.elapsed_ms > i64::MAX as u64
            || self.snapshots(snapshot.note_id)?.len() >= SNAPSHOT_MAX_COUNT
        {
            return Err(Error::Invalid("snapshot is invalid or note limit reached"));
        }
        let path = self.snapshot_path(snapshot.id)?;
        std::fs::create_dir_all(path.parent().unwrap())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                path.parent().unwrap(),
                std::fs::Permissions::from_mode(0o700),
            )?;
        }
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        if let Err(error) = file.write_all(jpeg).and_then(|_| file.sync_all()) {
            let _ = std::fs::remove_file(&path);
            return Err(error.into());
        }
        if let Err(error) = self.conn.execute(
            "INSERT INTO snapshots VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                snapshot.id.to_string(),
                snapshot.note_id.to_string(),
                snapshot.captured_at.to_rfc3339(),
                snapshot.elapsed_ms,
                snapshot.source,
                snapshot.use_in_summary
            ],
        ) {
            let _ = std::fs::remove_file(path);
            return Err(error.into());
        }
        Ok(())
    }
    pub fn snapshot_bytes(&self, note: Uuid, id: Uuid) -> Result<Vec<u8>> {
        if !self.snapshots(note)?.iter().any(|s| s.id == id) {
            return Err(Error::NotFound);
        }
        Ok(std::fs::read(self.snapshot_path(id)?)?)
    }
    pub fn exclude_snapshot(&mut self, note: Uuid, id: Uuid, excluded: bool) -> Result<()> {
        if self.conn.execute(
            "UPDATE snapshots SET use_in_summary=? WHERE note_id=? AND id=?",
            params![!excluded, note.to_string(), id.to_string()],
        )? == 0
        {
            return Err(Error::NotFound);
        }
        Ok(())
    }
    pub fn delete_snapshot(&mut self, note: Uuid, id: Uuid) -> Result<()> {
        if !self.snapshots(note)?.iter().any(|s| s.id == id) {
            return Err(Error::NotFound);
        }
        let path = self.snapshot_path(id)?;
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        self.conn.execute(
            "DELETE FROM snapshots WHERE note_id=? AND id=?",
            params![note.to_string(), id.to_string()],
        )?;
        Ok(())
    }
    /// Also removes orphan files left by a crash between a cascade and file cleanup.
    pub fn cleanup_snapshot_files(&self) -> Result<()> {
        let Some(root) = &self.snapshot_directory else {
            return Ok(());
        };
        if !root.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            if entry.path().extension().and_then(|s| s.to_str()) != Some("jpg") {
                continue;
            }
            let Some(id) = entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| Uuid::parse_str(s).ok())
            else {
                continue;
            };
            let exists: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM snapshots WHERE id=?)",
                [id.to_string()],
                |r| r.get(0),
            )?;
            if !exists {
                std::fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
    pub fn apply_snapshot_retention(&mut self, days: u32) -> Result<usize> {
        let cutoff = (Utc::now() - Duration::days(i64::from(days))).to_rfc3339();
        let count = self
            .conn
            .execute("DELETE FROM snapshots WHERE captured_at < ?", [cutoff])?;
        self.cleanup_snapshot_files()?;
        Ok(count)
    }
}
