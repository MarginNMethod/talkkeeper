use chrono::Utc;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc,
    time::Duration,
};
use talkkeeper_core::{
    Attendee, CalendarEvent, CalendarSource, Folder, Note, Speaker, Store, TranscriptSegment,
};
use uuid::Uuid;
struct Client {
    child: Child,
    input: ChildStdin,
    output: mpsc::Receiver<Value>,
    seq: u64,
}
impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Client {
    fn new(db: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_talkkeeper-mcp"))
            .args(["--db"])
            .arg(db)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let out = child.stdout.take().unwrap();
        let (tx, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                let line = line.unwrap();
                let value =
                    serde_json::from_str(&line).expect("stdout must contain only protocol JSON");
                if tx.send(value).is_err() {
                    break;
                }
            }
        });
        let mut c = Self {
            child,
            input,
            output,
            seq: 0,
        };
        let init = c.request("initialize",json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}));
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        c.raw(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}).to_string());
        c
    }
    fn raw(&mut self, s: &str) {
        writeln!(self.input, "{s}").unwrap();
        self.input.flush().unwrap();
    }
    fn receive(&self) -> Value {
        self.output
            .recv_timeout(Duration::from_secs(15))
            .expect("protocol response within timeout")
    }
    fn request(&mut self, method: &str, params: Value) -> Value {
        self.seq += 1;
        let id = self.seq;
        self.raw(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string());
        loop {
            let r = self.receive();
            if r["id"] == id {
                return r;
            }
        }
    }
    fn tool(&mut self, name: &str, args: Value) -> Value {
        self.request("tools/call", json!({"name":name,"arguments":args}))["result"].clone()
    }
}
fn text(r: &Value) -> String {
    r["content"][0]["text"].as_str().unwrap().into()
}
fn results(r: &Value) -> Vec<Value> {
    serde_json::from_str::<Value>(&text(r)).unwrap()["results"]
        .as_array()
        .unwrap()
        .clone()
}
fn enabled(store: &mut Store, key: &str, value: bool) {
    store
        .set_setting(&format!("mcp.{key}"), &json!(value))
        .unwrap();
}
fn fixture() -> (tempfile::TempDir, Store, Note) {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().join("talkkeeper.sqlite")).unwrap();
    let mut note = Note::new("Garden planning");
    note.notes_markdown = "Plan the garden beds".into();
    note.summary_markdown = Some("Plant herbs".into());
    note.attendees = vec![Attendee {
        name: "Alex".into(),
        email: "alex@example.test".into(),
    }];
    store.create_note(&note).unwrap();
    store
        .append_transcript_segments(&[TranscriptSegment {
            id: Uuid::new_v4(),
            note_id: note.id,
            seq: 1,
            start_ms: 100,
            end_ms: 500,
            speaker: Speaker::Me,
            text: "transcriptsecret lavender".into(),
            lang: None,
            created_at: Utc::now(),
        }])
        .unwrap();
    store
        .set_setting("provider.private", &json!("sk-fake-NEVER-EXPOSE-SECRET"))
        .unwrap();
    (dir, store, note)
}
#[test]
fn protocol_tools_privacy_and_live_settings() {
    let (dir, mut store, note) = fixture();
    let mut c = Client::new(&dir.path().join("talkkeeper.sqlite"));
    let listed = c.request("tools/list", json!({}));
    assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 8);
    for &tool in talkkeeper_mcp::TOOLS {
        assert!(text(&c.tool(tool, json!({}))).contains("Turn on"));
    }
    enabled(&mut store, "enabled", true);
    assert!(text(&c.tool("get_note", json!({"id":note.id}))).contains("Withheld"));
    assert!(!text(&c.tool("get_note", json!({"id":note.id}))).contains("transcriptsecret"));
    assert!(results(&c.tool("search_notes", json!({"query":"lavender"}))).is_empty());
    assert_eq!(
        results(&c.tool("search_notes", json!({"query":"garden","attendee":"alex"}))).len(),
        1
    );
    assert!(c.tool("get_transcript", json!({"id":note.id}))["isError"] == true);
    assert!(c.tool("list_upcoming_meetings", json!({}))["isError"] == true);
    let folder = Folder {
        id: Uuid::new_v4(),
        name: "Work".into(),
        parent_id: None,
    };
    store.create_folder(&folder).unwrap();
    assert_eq!(
        results(&c.tool("list_folders", json!({})))[0]["name"],
        "Work"
    );
    let people = results(&c.tool("list_people", json!({})));
    assert_eq!(people[0]["name"], "Alex");
    assert_eq!(
        results(&c.tool("get_person", json!({"id":people[0]["id"]})))[0]["email"],
        "alex@example.test"
    );
    enabled(&mut store, "include_transcripts", true);
    assert!(text(&c.tool("get_transcript", json!({"id":note.id}))).contains("transcriptsecret"));
    assert!(
        results(&c.tool("get_transcript", json!({"id":note.id,"start_ms":1000})))[0]["segments"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        results(&c.tool("search_notes", json!({"query":"lavender"}))).len(),
        1
    );
    for &tool in talkkeeper_mcp::TOOLS {
        let response = c.tool(
            tool,
            match tool {
                "search_notes" => json!({"query":"garden"}),
                "get_note" | "get_transcript" => json!({"id":note.id}),
                "get_person" => json!({"id":people[0]["id"]}),
                _ => json!({}),
            },
        );
        assert!(!response.to_string().contains("sk-fake"));
    }
    let trashed = Note::new("trashonly");
    store.create_note(&trashed).unwrap();
    store.trash_note(trashed.id).unwrap();
    assert!(results(&c.tool("search_notes", json!({"query":"trashonly"}))).is_empty());
    assert!(c.tool("get_note", json!({"id":trashed.id}))["isError"] == true);
    assert_eq!(results(&c.tool("list_notes", json!({}))).len(), 1);
    enabled(&mut store, "enabled", false);
    assert!(text(&c.tool("list_notes", json!({}))).contains("Turn on"));
    let log = std::fs::read_to_string(dir.path().join("mcp-access.log")).unwrap();
    for line in log.lines() {
        let row: Value = serde_json::from_str(line).unwrap();
        assert_eq!(row.as_object().unwrap().len(), 3);
        assert!(row["timestamp"].is_string());
        assert!(row["results"].is_number());
    }
    assert!(!log.contains("garden") && !log.contains("lavender") && !log.contains("sk-fake"));
}
#[test]
fn server_exits_when_the_client_closes_its_input() {
    let (dir, store, _note) = fixture();
    let db = dir.path().join("talkkeeper.sqlite");
    drop(store);
    let mut c = Client::new(&db);
    // A client that is gone must not leave a process (and an open database) behind.
    drop(std::mem::replace(
        &mut c.input,
        Command::new(env!("CARGO_BIN_EXE_talkkeeper-mcp"))
            .arg("--help")
            .stdin(Stdio::piped())
            .spawn()
            .unwrap()
            .stdin
            .take()
            .unwrap(),
    ));
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = c.child.try_wait().unwrap() {
            assert!(status.success(), "server should exit cleanly");
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "server still running 10 seconds after its input closed"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}
#[test]
fn malformed_inputs_limits_and_read_only() {
    let (dir, mut store, mut note) = fixture();
    enabled(&mut store, "enabled", true);
    note.notes_markdown = "界".repeat(20000);
    store.update_note(&note).unwrap();
    let db = dir.path().join("talkkeeper.sqlite");
    // Checkpoint by closing the app, then compare main database bytes after all server calls.
    drop(store);
    let before = std::fs::read(&db).unwrap();
    let mut c = Client::new(&db);
    for args in [
        json!({"limit":51}),
        json!({"limit":0}),
        json!({"folder":"invalid"}),
        json!({"date_from":"bad"}),
        json!({"unexpected":true}),
        json!({"query":"wrong tool"}),
        json!({"limit":1.5}),
    ] {
        assert_eq!(c.tool("list_notes", args)["isError"], true);
    }
    for args in [json!({}), json!({"query":"x".repeat(513)})] {
        assert_eq!(c.tool("search_notes", args)["isError"], true);
    }
    assert_eq!(
        c.tool("get_note", json!({"id":Uuid::new_v4()}))["isError"],
        true
    );
    assert_eq!(c.tool("unknown sk-fake", json!({}))["isError"], true);
    c.raw("{not JSON}");
    assert!(c.receive()["error"].is_object());
    c.raw(&"x".repeat(talkkeeper_mcp::MAX_INPUT + 100));
    assert!(c.receive()["error"].is_object());
    assert!(c.request("unknown_method", json!({}))["error"].is_object());
    let r = c.tool("get_note", json!({"id":note.id}));
    assert!(text(&r).contains("truncated"));
    assert!(text(&r).len() <= talkkeeper_mcp::MAX_RESPONSE);
    assert_eq!(before, std::fs::read(&db).unwrap());
    let mut readonly = Store::open_read_only(&db).unwrap();
    assert!(readonly.set_setting("test", &json!(true)).is_err());
    assert!(readonly.create_note(&Note::new("write forbidden")).is_err());
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.pragma_update(None, "user_version", 8).unwrap();
    assert!(Store::open_read_only(&db).is_err());
    conn.pragma_update(None, "user_version", 6).unwrap();
    assert!(Store::open_read_only(&db).is_err());
}
#[test]
fn calendar_cache_requires_explicit_permission() {
    let (dir, mut store, _) = fixture();
    enabled(&mut store, "enabled", true);
    let source = CalendarSource {
        id: "source".into(),
        name: "Private".into(),
        color: "blue".into(),
        enabled: true,
        sync_minutes: 15,
        last_synced_at: None,
        last_error: None,
        etag: None,
        last_modified: None,
    };
    store.save_calendar_source(&source).unwrap();
    let event = CalendarEvent {
        source_id: source.id.clone(),
        uid: "u".into(),
        instance_start: Utc::now() + chrono::Duration::hours(1),
        instance_end: Utc::now() + chrono::Duration::hours(2),
        all_day: false,
        title: "privatecalendartitle".into(),
        location: "hiddenlocation".into(),
        description: "hiddendescription".into(),
        organizer: "hiddenorganizer".into(),
        attendees: vec![Attendee {
            name: "Calendarperson".into(),
            email: "cal@example.test".into(),
        }],
        meeting_url: Some("https://example.test/join".into()),
        status: "CONFIRMED".into(),
    };
    store
        .replace_calendar_events(&source.id, std::slice::from_ref(&event))
        .unwrap();
    let n = store.start_calendar_note(&event).unwrap();
    let mut c = Client::new(&dir.path().join("talkkeeper.sqlite"));
    assert!(!text(&c.tool("get_note", json!({"id":n.id}))).contains("privatecalendartitle"));
    assert!(results(&c.tool("search_notes", json!({"query":"privatecalendartitle"}))).is_empty());
    assert!(!text(&c.tool("list_people", json!({}))).contains("Calendarperson"));
    enabled(&mut store, "include_calendar", true);
    let r = c.tool("list_upcoming_meetings", json!({"days":7}));
    let s = text(&r);
    assert!(s.contains("privatecalendartitle") && s.contains("https://example.test/join"));
    assert!(!s.contains("hidden"));
    assert_eq!(
        results(&c.tool("search_notes", json!({"query":"privatecalendartitle"}))).len(),
        1
    );
}
#[test]
fn wal_existing_database_concurrent_app_writes_and_rotation() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("talkkeeper.sqlite");
    {
        let _store = Store::open(&db).unwrap();
    }
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.pragma_update(None, "journal_mode", "DELETE").unwrap();
    drop(conn);
    let mut store = Store::open(&db).unwrap();
    enabled(&mut store, "enabled", true);
    let conn = rusqlite::Connection::open(&db).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "wal"
    );
    let mut c = Client::new(&db);
    conn.execute_batch("BEGIN IMMEDIATE; UPDATE settings SET value=value;")
        .unwrap();
    assert!(results(&c.tool("list_notes", json!({}))).is_empty());
    conn.execute_batch("COMMIT").unwrap();
    store
        .create_note(&Note::new("Visible immediately"))
        .unwrap();
    assert_eq!(results(&c.tool("list_notes", json!({}))).len(), 1);
    std::fs::write(
        dir.path().join("mcp-access.log"),
        vec![b' '; talkkeeper_mcp::access::LOG_BYTES as usize],
    )
    .unwrap();
    c.tool("list_notes", json!({}));
    assert!(dir.path().join("mcp-access.1.log").exists());
    assert!(dir.path().join("mcp-access.log").metadata().unwrap().len() < 1024);
    for _ in 0..25 {
        c.tool("list_notes", json!({}));
    }
    assert_eq!(
        talkkeeper_mcp::access::recent(dir.path()).unwrap().len(),
        20
    );
    talkkeeper_mcp::access::clear(dir.path()).unwrap();
    assert!(talkkeeper_mcp::access::recent(dir.path())
        .unwrap()
        .is_empty());
}
#[test]
fn check_and_missing_database_never_create_data() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("missing.sqlite");
    let r = Command::new(env!("CARGO_BIN_EXE_talkkeeper-mcp"))
        .arg("--db")
        .arg(&db)
        .arg("--check")
        .output()
        .unwrap();
    assert!(!r.status.success());
    assert!(!db.exists());
    assert!(String::from_utf8(r.stdout)
        .unwrap()
        .contains("missing.sqlite"));
    let _store = Store::open(&db).unwrap();
    let r = Command::new(env!("CARGO_BIN_EXE_talkkeeper-mcp"))
        .arg("--db")
        .arg(&db)
        .arg("--check")
        .output()
        .unwrap();
    assert!(r.status.success());
    assert!(String::from_utf8(r.stdout).unwrap().contains("Turn on"));
}

#[test]
fn filtered_lists_and_escaped_response_budget() {
    let (dir, mut store, mut note) = fixture();
    enabled(&mut store, "enabled", true);
    enabled(&mut store, "include_transcripts", true);
    let folder = Folder {
        id: Uuid::new_v4(),
        name: "Garden".into(),
        parent_id: None,
    };
    store.create_folder(&folder).unwrap();
    note.folder_id = Some(folder.id);
    note.notes_markdown = "\\\"".repeat(6000);
    store.update_note(&note).unwrap();
    let segments: Vec<_> = (2..=60)
        .map(|seq| TranscriptSegment {
            id: Uuid::new_v4(),
            note_id: note.id,
            seq,
            start_ms: seq * 1000,
            end_ms: seq * 1000 + 100,
            speaker: Speaker::Me,
            text: "\\\"\n".repeat(2000),
            lang: None,
            created_at: Utc::now(),
        })
        .collect();
    store.append_transcript_segments(&segments).unwrap();
    let mut c = Client::new(&dir.path().join("talkkeeper.sqlite"));
    assert_eq!(results(&c.tool("list_notes",json!({"folder":folder.id,"date_from":"2000-01-01T00:00:00Z","date_to":"2100-01-01T00:00:00Z","limit":1}))).len(),1);
    assert!(results(&c.tool("list_notes", json!({"folder":Uuid::new_v4()}))).is_empty());
    assert!(results(&c.tool("list_notes", json!({"date_to":"2000-01-01T00:00:00Z"}))).is_empty());
    for tool in ["get_note", "get_transcript"] {
        let response = c.tool(tool, json!({"id":note.id}));
        assert!(response.to_string().len() <= talkkeeper_mcp::MAX_RESPONSE);
        assert_eq!(results(&response).len(), 1);
        assert!(text(&response).contains("truncated"));
    }
    for _ in 0..55 {
        store.create_note(&Note::new("Another garden")).unwrap();
    }
    assert_eq!(
        results(&c.tool("list_notes", json!({"limit":50}))).len(),
        50
    );
    assert_eq!(
        results(&c.tool("search_notes", json!({"query":"garden","limit":2}))).len(),
        2
    );
}
