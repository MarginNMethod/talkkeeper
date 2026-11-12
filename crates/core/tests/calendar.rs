use chrono::{Duration, Utc};
use talkkeeper_core::*;
fn source() -> CalendarSource {
    CalendarSource {
        id: "local".into(),
        name: "Planning".into(),
        color: "#537cad".into(),
        enabled: true,
        sync_minutes: 15,
        last_synced_at: None,
        last_error: None,
        etag: None,
        last_modified: None,
    }
}
#[test]
fn cache_links_people_and_source_removal() {
    let mut s = Store::open_in_memory().unwrap();
    let mut source = source();
    s.save_calendar_source(&source).unwrap();
    let e = CalendarEvent {
        source_id: source.id.clone(),
        uid: "one".into(),
        instance_start: Utc::now(),
        instance_end: Utc::now() + Duration::hours(1),
        all_day: false,
        title: "Design review".into(),
        location: String::new(),
        description: String::new(),
        organizer: String::new(),
        attendees: vec![Attendee {
            name: "Alex".into(),
            email: "alex@example.test".into(),
        }],
        meeting_url: None,
        status: String::new(),
    };
    s.replace_calendar_events(&source.id, std::slice::from_ref(&e))
        .unwrap();
    let n = s.start_calendar_note(&e).unwrap();
    assert_eq!(s.start_calendar_note(&e).unwrap().id, n.id);
    assert_eq!(s.list_people().unwrap().len(), 1);
    source.name = "Renamed".into();
    s.save_calendar_source(&source).unwrap();
    assert!(s.note_calendar_event(n.id).unwrap().is_some());
    assert_eq!(
        s.calendar_safe_note(n.clone(), false).unwrap().title,
        "Meeting notes"
    );
    assert_eq!(
        s.calendar_safe_note(n.clone(), true).unwrap().title,
        n.title
    );
    source.enabled = false;
    s.save_calendar_source(&source).unwrap();
    assert!(s.calendar_events().unwrap().is_empty());
    assert!(s
        .calendar_safe_note(n.clone(), false)
        .unwrap()
        .attendees
        .is_empty());
    s.remove_calendar_source(&source.id).unwrap();
    assert!(s.get_note(n.id).unwrap().is_some());
    assert!(s.note_calendar_event(n.id).unwrap().is_none());
}
#[test]
fn upgrade_from_six_preserves_notes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old.sqlite");
    let c = rusqlite::Connection::open(&path).unwrap();
    for sql in [
        include_str!("../migrations/001_initial.sql"),
        include_str!("../migrations/002_chat.sql"),
        include_str!("../migrations/003_workspace.sql"),
        include_str!("../migrations/004_people.sql"),
        include_str!("../migrations/005_dictation.sql"),
        include_str!("../migrations/006_snapshots.sql"),
    ] {
        c.execute_batch(sql).unwrap();
    }
    c.pragma_update(None, "user_version", 6).unwrap();
    drop(c);
    let mut s = Store::open(&path).unwrap();
    s.save_calendar_source(&source()).unwrap();
    assert_eq!(s.calendar_sources().unwrap().len(), 1);
}
