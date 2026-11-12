use chrono::{Duration, Utc};
use talkkeeper_core::*;
use uuid::Uuid;
fn snapshot(note: &Note) -> Snapshot {
    Snapshot {
        id: Uuid::new_v4(),
        note_id: note.id,
        captured_at: Utc::now(),
        elapsed_ms: 10000,
        source: "Slides".into(),
        use_in_summary: true,
    }
}
#[test]
fn snapshot_files_limits_retention_trash_restore_and_cascade() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.sqlite");
    let mut store = Store::open(&path).unwrap();
    let note = Note::new("Slides");
    store.create_note(&note).unwrap();
    let mut old = snapshot(&note);
    old.captured_at -= Duration::days(40);
    store.add_snapshot(&old, &[255, 216, 255, 217]).unwrap();
    let current = snapshot(&note);
    store.add_snapshot(&current, &[255, 216, 255, 217]).unwrap();
    assert_eq!(store.snapshots(note.id).unwrap().len(), 2);
    store.exclude_snapshot(note.id, current.id, true).unwrap();
    assert!(
        !store
            .snapshots(note.id)
            .unwrap()
            .iter()
            .find(|s| s.id == current.id)
            .unwrap()
            .use_in_summary
    );
    store.trash_note(note.id).unwrap();
    assert!(store.add_snapshot(&snapshot(&note), &[255, 216]).is_err());
    assert_eq!(store.snapshots(note.id).unwrap().len(), 2);
    store.restore_note(note.id).unwrap();
    assert_eq!(store.apply_snapshot_retention(30).unwrap(), 1);
    assert!(!dir
        .path()
        .join(format!("snapshots/{}.jpg", old.id))
        .exists());
    let mut oversized = vec![255; SNAPSHOT_MAX_BYTES + 1];
    oversized[1] = 216;
    assert!(store.add_snapshot(&snapshot(&note), &oversized).is_err());
    for _ in 1..SNAPSHOT_MAX_COUNT {
        store.add_snapshot(&snapshot(&note), &[255, 216]).unwrap();
    }
    assert!(store.add_snapshot(&snapshot(&note), &[255, 216]).is_err());
    store.delete_snapshot(note.id, current.id).unwrap();
    assert!(store.snapshot_bytes(note.id, current.id).is_err());
    drop(store);
    let mut store = Store::open(&path).unwrap();
    assert_eq!(store.snapshots(note.id).unwrap().len(), 59);
    store.purge_note(note.id).unwrap();
    assert!(store.snapshots(note.id).unwrap().is_empty());
    assert_eq!(
        std::fs::read_dir(dir.path().join("snapshots"))
            .unwrap()
            .count(),
        0
    );
}
#[test]
fn migration_from_v4_and_v5_and_reopen() {
    for version in [4, 5] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../migrations/002_chat.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../migrations/003_workspace.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../migrations/004_people.sql"))
            .unwrap();
        conn.pragma_update(None, "user_version", version).unwrap();
        drop(conn);
        let store = Store::open(&path).unwrap();
        assert!(store.snapshots(Uuid::nil()).unwrap().is_empty());
        drop(store);
        assert!(Store::open(&path).is_ok());
    }
}
