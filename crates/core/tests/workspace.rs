use talkkeeper_core::*;
use uuid::Uuid;
#[test]
fn migration_crud_and_import() {
    let mut store = Store::open_in_memory().unwrap();
    let chat = WorkspaceChat {
        id: Uuid::new_v4(),
        name: "Test".into(),
        scope: Scope::default(),
        messages: vec![],
        attachments: vec![Attachment {
            name: "context.md".into(),
            text: "Local context".into(),
        }],
    };
    store.save_workspace_chat(&chat).unwrap();
    assert_eq!(store.list_workspace_chats().unwrap().len(), 1);
    assert_eq!(
        store
            .get_workspace_chat(chat.id)
            .unwrap()
            .unwrap()
            .attachments
            .len(),
        1
    );
    store.delete_workspace_chat(chat.id).unwrap();
    assert!(store.list_workspace_chats().unwrap().is_empty());
    let mut recipe = built_in_recipes().remove(0);
    recipe.prompt = "{{notes}} / {{topic}}".into();
    assert_eq!(recipe.render("{{topic}}", "garden"), "{{topic}} / garden");
    store.save_recipe(&recipe).unwrap();
    recipe.name = "Edited".into();
    store.save_recipe(&recipe).unwrap();
    assert_eq!(store.list_recipes().unwrap()[0].name, "Edited");
    let imported = Recipe::import(&serde_json::to_string(&recipe).unwrap()).unwrap();
    assert_ne!(imported.id, recipe.id);
    assert!(Recipe::import("{}").is_err());
    assert!(Recipe::import(&"x".repeat(32769)).is_err());
    assert!(Recipe::import(&serde_json::to_string(&serde_json::json!({"id":recipe.id,"name":"x","description":"","prompt":"x","default_scope":{},"execute":"shell"})).unwrap()).is_err());
    store.delete_recipe(recipe.id).unwrap();
    assert!(store.list_recipes().unwrap().is_empty());
    assert!(Attachment {
        name: "bad.exe".into(),
        text: "data".into()
    }
    .validate()
    .is_err());
}
#[test]
fn retrieval_scopes_budget_ranking_and_trash() {
    let mut store = Store::open_in_memory().unwrap();
    let a = Note::new("Garden");
    let mut b = Note::new("Other");
    b.summary_markdown = Some("Garden funding approved".into());
    store.create_note(&a).unwrap();
    store.create_note(&b).unwrap();
    store
        .append_transcript_segments(&[TranscriptSegment {
            id: Uuid::new_v4(),
            note_id: a.id,
            seq: 1,
            start_ms: 90000,
            end_ms: 92000,
            speaker: Speaker::Me,
            text: "Garden funding approved by Alex".into(),
            lang: None,
            created_at: chrono::Utc::now(),
        }])
        .unwrap();
    let r = store
        .retrieve(&Scope::default(), "garden funding?", 2000)
        .unwrap();
    assert_eq!(r.notes_searched, 2);
    assert_eq!(r.segments_searched, 2);
    assert_eq!(r.sources.len(), 2);
    assert_eq!(r.sources[0].note_id, b.id); // shorter matching section has stronger BM25
    assert!(store
        .retrieve(&Scope::default(), "garden", 1)
        .unwrap()
        .sources
        .is_empty());
    assert!(
        r.sources
            .iter()
            .map(|s| serde_json::to_vec(s).unwrap().len())
            .sum::<usize>()
            <= 2000
    );
    let scope = Scope {
        note_ids: Some(vec![a.id]),
        ..Default::default()
    };
    assert_eq!(
        store.retrieve(&scope, "garden", 2000).unwrap().sources[0].start_ms,
        90000
    );
    store.trash_note(a.id).unwrap();
    assert_eq!(
        store
            .retrieve(&Scope::default(), "garden", 2000)
            .unwrap()
            .sources
            .len(),
        1
    );
    assert!(store
        .retrieve(&Scope::default(), "unrelated", 2000)
        .unwrap()
        .sources
        .is_empty());
}

#[test]
fn upgrades_existing_database_and_reopens_local_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    conn.pragma_update(None, "user_version", 1).unwrap();
    let mut note = Note::new("Existing");
    note.notes_markdown = "existing garden decision".into();
    conn.execute(
        "INSERT INTO notes VALUES (?,?,NULL)",
        rusqlite::params![note.id.to_string(), serde_json::to_string(&note).unwrap()],
    )
    .unwrap();
    drop(conn);
    let mut store = Store::open(&path).unwrap();
    assert_eq!(
        store
            .retrieve(&Scope::default(), "garden", 1000)
            .unwrap()
            .sources
            .len(),
        1
    );
    let chat = WorkspaceChat {
        id: Uuid::new_v4(),
        name: "Saved".into(),
        scope: Default::default(),
        messages: vec![],
        attachments: vec![],
    };
    store.save_workspace_chat(&chat).unwrap();
    drop(store);
    assert_eq!(
        Store::open(&path).unwrap().list_workspace_chats().unwrap()[0].id,
        chat.id
    );
}

#[test]
fn recency_folder_dates_and_large_segment_excerpt() {
    let mut store = Store::open_in_memory().unwrap();
    let folder = Folder {
        id: Uuid::new_v4(),
        name: "Work".into(),
        parent_id: None,
    };
    store.create_folder(&folder).unwrap();
    let mut recent = Note::new("Recent");
    recent.folder_id = Some(folder.id);
    recent.notes_markdown = "garden funding".repeat(500);
    let mut older = recent.clone();
    older.id = Uuid::new_v4();
    older.title = "Older".into();
    older.created_at -= chrono::Duration::days(30);
    store.create_note(&older).unwrap();
    store.create_note(&recent).unwrap();
    let r = store.retrieve(&Scope::default(), "garden", 600).unwrap();
    assert_eq!(r.sources[0].note_id, recent.id);
    assert!(!r.sources[0].text.is_empty());
    assert!(serde_json::to_vec(&r.sources[0]).unwrap().len() <= 600);
    let scope = Scope {
        folder_id: Some(folder.id),
        date_from: Some(chrono::Utc::now() - chrono::Duration::days(1)),
        ..Default::default()
    };
    assert_eq!(
        store
            .retrieve(&scope, "garden", 1000)
            .unwrap()
            .notes_searched,
        1
    );
    assert_eq!(
        store
            .retrieve(
                &Scope {
                    note_ids: Some(vec![]),
                    ..Default::default()
                },
                "garden",
                1000
            )
            .unwrap()
            .notes_searched,
        0
    );
}
