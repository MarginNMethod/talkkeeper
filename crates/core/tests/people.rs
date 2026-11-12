use talkkeeper_core::{Attendee, Note, Store};
fn note(name: &str, email: &str) -> Note {
    let mut n = Note::new("Planning");
    n.attendees.push(Attendee {
        name: name.into(),
        email: email.into(),
    });
    n
}
#[test]
fn directory_identity_manual_edits_and_history() {
    let mut db = Store::open_in_memory().unwrap();
    let n = note("Ada", "ADA@EXAMPLE.ORG");
    db.create_note(&n).unwrap();
    db.create_note(&note("Ada", "ada@example.org")).unwrap();
    db.create_note(&note("Friend", "friend@gmail.com")).unwrap();
    let before = db.list_people().unwrap();
    db.rebuild_people().unwrap();
    db.rebuild_people().unwrap();
    assert_eq!(before, db.list_people().unwrap());
    assert_eq!(before.len(), 2);
    let companies = db.list_companies().unwrap();
    assert_eq!(companies.len(), 1);
    assert_eq!(companies[0].name, "Example");
    let mut p = before.into_iter().find(|p| p.name == "Ada").unwrap();
    assert_eq!(db.person_meetings(p.id).unwrap().len(), 2);
    p.name = "Edited name".into();
    p.email = "edited@elsewhere.org".into();
    p.company_id = None;
    db.update_person(&p).unwrap();
    db.update_note(&n).unwrap();
    let saved = db
        .list_people()
        .unwrap()
        .into_iter()
        .find(|a| a.id == p.id)
        .unwrap();
    assert_eq!(saved.name, p.name);
    assert_eq!(saved.email, p.email);
    assert_eq!(saved.company_id, None);
    db.trash_note(n.id).unwrap();
    assert_eq!(db.person_meetings(p.id).unwrap().len(), 1);
    db.restore_note(n.id).unwrap();
    assert_eq!(db.person_meetings(p.id).unwrap().len(), 2);
}
#[test]
fn merge_aliases_survive_rebuild_and_undo_restores_links() {
    let mut db = Store::open_in_memory().unwrap();
    db.create_note(&note("Ada Smith", "one@example.org"))
        .unwrap();
    db.create_note(&note("Ada Smith", "two@example.org"))
        .unwrap();
    let pairs = db.duplicate_people().unwrap();
    assert_eq!(pairs.len(), 1);
    let (a, b) = &pairs[0];
    db.merge_people(a.id, b.id).unwrap();
    assert_eq!(db.person_meetings(a.id).unwrap().len(), 2);
    db.undo_people_merge().unwrap();
    assert_eq!(db.list_people().unwrap().len(), 2);
    assert_eq!(db.person_meetings(a.id).unwrap().len(), 1);
    db.merge_people(a.id, b.id).unwrap();
    db.rebuild_people().unwrap();
    assert_eq!(db.list_people().unwrap().len(), 1);
    assert!(db.undo_people_merge().is_err());
}
#[test]
fn upgrades_existing_notes_and_reopens_idempotently() {
    let path = std::env::temp_dir().join(format!("people-{}.sqlite", uuid::Uuid::new_v4()));
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    conn.pragma_update(None, "user_version", 1).unwrap();
    let n = note("Legacy", "legacy@example.org");
    conn.execute(
        "INSERT INTO notes VALUES (?,?,NULL)",
        rusqlite::params![n.id.to_string(), serde_json::to_string(&n).unwrap()],
    )
    .unwrap();
    drop(conn);
    let db = Store::open(&path).unwrap();
    let people = db.list_people().unwrap();
    assert_eq!(people.len(), 1);
    drop(db);
    let db = Store::open(&path).unwrap();
    assert_eq!(people, db.list_people().unwrap());
    drop(db);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn names_fall_back_without_email_and_similar_names_are_suggested() {
    let mut db = Store::open_in_memory().unwrap();
    let mut n = note("  Morgan Reed  ", "");
    db.create_note(&n).unwrap();
    db.create_note(&note("morgan reed", "")).unwrap();
    assert_eq!(db.list_people().unwrap().len(), 1);
    db.create_note(&note("Morgan Read", "morgan@studio.org"))
        .unwrap();
    assert_eq!(db.duplicate_people().unwrap().len(), 1);
    let company = db.list_companies().unwrap()[0].id;
    assert_eq!(db.company_meetings(company).unwrap().len(), 1);
    n.attendees.clear();
    db.update_note(&n).unwrap();
    let name_only = db
        .list_people()
        .unwrap()
        .into_iter()
        .find(|p| p.email.is_empty())
        .unwrap();
    assert_eq!(db.person_meetings(name_only.id).unwrap().len(), 1);
    assert!(db.merge_people(name_only.id, uuid::Uuid::new_v4()).is_err());
    assert_eq!(db.list_people().unwrap().len(), 2);
}
