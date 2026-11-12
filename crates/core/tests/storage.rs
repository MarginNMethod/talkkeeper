use chrono::{Duration, TimeZone, Utc};
use talkkeeper_core::*;
use uuid::Uuid;

fn fixture() -> Note {
    let mut n = Note::new("Planning, session");
    n.id = Uuid::nil();
    n.created_at = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
    n.updated_at = n.created_at;
    n.started_at = Some(n.created_at);
    n.attendees = vec![Attendee {
        name: "Ada".into(),
        email: "ada@example.test".into(),
    }];
    n.summary_markdown = Some("Ship the draft.".into());
    n.notes_markdown = "Review\ntomorrow".into();
    n
}
fn segment(n: &Note, seq: u64, text: &str) -> TranscriptSegment {
    TranscriptSegment {
        id: Uuid::new_v4(),
        note_id: n.id,
        seq,
        start_ms: 61000,
        end_ms: 62000,
        speaker: Speaker::Named("Ada".into()),
        text: text.into(),
        lang: Some("en".into()),
        created_at: Utc::now(),
    }
}
#[test]
fn migrations_persist_and_crud() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let mut s = Store::open(&path).unwrap();
    let mut n = fixture();
    s.create_note(&n).unwrap();
    assert!(s.create_note(&n).is_err());
    n.title = "Changed".into();
    s.update_note(&n).unwrap();
    drop(s);
    let mut s = Store::open(&path).unwrap();
    assert_eq!(s.get_note(n.id).unwrap().unwrap().title, "Changed");
    s.set_setting("locale", &serde_json::json!("en")).unwrap();
    assert_eq!(
        s.get_setting("locale").unwrap(),
        Some(serde_json::json!("en"))
    );
    s.purge_note(n.id).unwrap();
    assert!(s.get_note(n.id).unwrap().is_none());
}
#[test]
fn segments_search_trash_and_retention() {
    let mut s = Store::open_in_memory().unwrap();
    let n = fixture();
    s.create_note(&n).unwrap();
    let mut old = segment(&n, 0, "ancientword");
    old.created_at = Utc::now() - Duration::days(40);
    let a = segment(&n, 1, "uniqueword");
    let b = segment(&n, 2, "selectionword");
    s.append_transcript_segments(&[old, a.clone(), b.clone()])
        .unwrap();
    let filters = SearchFilters::default();
    assert_eq!(s.search("uniqueword", &filters, 10).unwrap().len(), 1);
    assert_eq!(s.search("ada", &filters, 10).unwrap().len(), 1);
    assert!(s
        .search(
            "ada",
            &SearchFilters {
                attendee: Some("other".into()),
                ..Default::default()
            },
            10
        )
        .unwrap()
        .is_empty());
    assert_eq!(s.apply_transcript_retention(30).unwrap(), 1);
    assert!(s.search("ancientword", &filters, 10).unwrap().is_empty());
    assert_eq!(s.delete_transcript_segments(n.id, &[b.id]).unwrap(), 1);
    assert!(s.search("selectionword", &filters, 10).unwrap().is_empty());
    s.trash_note(n.id).unwrap();
    assert!(s.list_notes().unwrap().is_empty());
    assert!(s.search("uniqueword", &filters, 10).unwrap().is_empty());
    s.restore_note(n.id).unwrap();
    assert_eq!(s.search("uniqueword", &filters, 10).unwrap().len(), 1);
    assert_eq!(s.delete_transcript_range(n.id, 1, 1).unwrap(), 1);
    assert!(s.search("uniqueword", &filters, 10).unwrap().is_empty());
    assert_eq!(
        s.get_note(n.id).unwrap().unwrap().summary_markdown,
        n.summary_markdown
    );
    s.trash_note(n.id).unwrap();
    assert_eq!(
        s.purge_trash_older_than(std::time::Duration::ZERO).unwrap(),
        1
    );
    assert!(s.list_transcript_segments(n.id).unwrap().is_empty());
}
#[test]
fn folders_vocabulary_and_atomic_failures() {
    let mut s = Store::open_in_memory().unwrap();
    let root = Folder {
        id: Uuid::new_v4(),
        name: "Root".into(),
        parent_id: None,
    };
    let child = Folder {
        id: Uuid::new_v4(),
        name: "Child".into(),
        parent_id: Some(root.id),
    };
    s.create_folder(&root).unwrap();
    s.create_folder(&child).unwrap();
    assert!(s
        .create_folder(&Folder {
            id: Uuid::new_v4(),
            name: "Deep".into(),
            parent_id: Some(child.id)
        })
        .is_err());
    assert!(s
        .update_folder(&Folder {
            parent_id: Some(child.id),
            ..root.clone()
        })
        .is_err());
    let mut n = fixture();
    n.folder_id = Some(child.id);
    s.create_note(&n).unwrap();
    assert!(s.delete_folder(root.id).is_err());
    s.delete_folder(child.id).unwrap();
    assert_eq!(s.get_note(n.id).unwrap().unwrap().folder_id, None);
    assert_eq!(s.list_folders().unwrap(), vec![root]);
    let a = segment(&n, 1, "rollbackword");
    let mut b = segment(&n, 1, "duplicate");
    b.id = Uuid::new_v4();
    assert!(s.append_transcript_segments(&[a, b]).is_err());
    assert!(s.list_transcript_segments(n.id).unwrap().is_empty());
    for i in 0..100 {
        s.create_vocabulary_term(&VocabularyTerm {
            id: Uuid::new_v4(),
            term: format!("term{i}"),
        })
        .unwrap();
    }
    assert!(s
        .create_vocabulary_term(&VocabularyTerm {
            id: Uuid::new_v4(),
            term: "overflow".into()
        })
        .is_err());
    let mut term = s.list_vocabulary().unwrap().remove(0);
    term.term = "updated".into();
    s.update_vocabulary_term(&term).unwrap();
    s.delete_vocabulary_term(term.id).unwrap();
    assert_eq!(s.list_vocabulary().unwrap().len(), 99);
}
#[test]
fn export_snapshots() {
    let mut s = Store::open_in_memory().unwrap();
    let n = fixture();
    s.create_note(&n).unwrap();
    s.append_transcript_segments(&[segment(&n, 0, "Ready, now")])
        .unwrap();
    assert_eq!(s.export_note_markdown(n.id).unwrap(),"# Planning, session\n\nDate: 2026-01-02T03:04:05+00:00\n\nAttendees: Ada <ada@example.test>\n\n## Summary\n\nShip the draft.\n\n## Your notes\n\nReview\ntomorrow\n\n## Transcript\n\n[01:01] Ada: Ready, now\n");
    let mut csv = Vec::new();
    s.export_all_csv(&mut csv).unwrap();
    assert_eq!(String::from_utf8(csv).unwrap(),"id,title,started_at,attendees,summary,notes,transcript\n00000000-0000-0000-0000-000000000000,\"Planning, session\",2026-01-02T03:04:05+00:00,Ada <ada@example.test>,Ship the draft.,\"Review\ntomorrow\",\"[01:01] Ada: Ready, now\n\"\n");
    assert!(!s
        .export_note_markdown_with_transcript(n.id, false)
        .unwrap()
        .contains("## Transcript"));
}

#[test]
fn search_filters_updates_and_cascade() {
    let mut s = Store::open_in_memory().unwrap();
    let folder = Folder {
        id: Uuid::new_v4(),
        name: "Work".into(),
        parent_id: None,
    };
    s.create_folder(&folder).unwrap();
    let mut n = fixture();
    n.folder_id = Some(folder.id);
    s.create_note(&n).unwrap();
    let filter = SearchFilters {
        folder_id: Some(folder.id),
        attendee: Some("ADA@EXAMPLE".into()),
        date_from: Some(n.created_at),
        date_to: Some(n.created_at),
    };
    let hits = s.search("draft", &filter, 1).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].snippet.contains("draft"));
    assert!(hits[0].rank.is_finite());
    assert!(s.search("draft", &filter, 0).unwrap().is_empty());
    assert!(s
        .search(
            "draft",
            &SearchFilters {
                folder_id: Some(Uuid::new_v4()),
                ..filter.clone()
            },
            10
        )
        .unwrap()
        .is_empty());
    assert!(s
        .search(
            "draft",
            &SearchFilters {
                date_from: Some(n.created_at + Duration::seconds(1)),
                ..filter.clone()
            },
            10
        )
        .unwrap()
        .is_empty());
    n.summary_markdown = Some("Replacement decision".into());
    n.notes_markdown = "updatedword".into();
    s.update_note(&n).unwrap();
    assert!(s.search("draft", &filter, 10).unwrap().is_empty());
    assert_eq!(s.search("updatedword", &filter, 10).unwrap().len(), 1);
    s.append_transcript_segments(&[segment(&n, 0, "cascade")])
        .unwrap();
    s.purge_note(n.id).unwrap();
    assert!(s.list_transcript_segments(n.id).unwrap().is_empty());
    assert!(s
        .search("cascade", &SearchFilters::default(), 10)
        .unwrap()
        .is_empty());
}
