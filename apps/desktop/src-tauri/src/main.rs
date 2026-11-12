#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod calendar;
mod chat;
mod dictation;
mod people;
mod session;
mod setup;
mod snapshots;
mod voice_flow;
mod workspace;

use futures_util::StreamExt;

use serde_json::{json, Value};

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use talkkeeper_core::{Note, SearchFilters, Store};

use talkkeeper_llm::{
    CompletionRequest, KeyringSecretStore, Message, ProviderConfig, Role, SecretStore,
};

use tauri::{Emitter, Manager};

use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

struct AppState {
    store: Arc<Mutex<Store>>,
    directory: PathBuf,
    capture: Mutex<Option<tokio::sync::mpsc::Sender<String>>>,
    clipboard: Mutex<Option<arboard::Clipboard>>,
    snapshots: Mutex<snapshots::SnapshotSession>,
}

fn templates(s: &AppState) -> Result<Vec<talkkeeper_templates::Template>> {
    let mut all = talkkeeper_templates::built_in_templates();

    let path = s.directory.join("templates.json");

    if path.exists() {
        all.extend(
            serde_json::from_slice::<Vec<talkkeeper_templates::Template>>(
                &std::fs::read(path).map_err(err)?,
            )
            .map_err(err)?,
        );
    }

    Ok(all)
}

fn provider(s: &AppState) -> Result<(Box<dyn talkkeeper_llm::LlmProvider>, String)> {
    let store = s.store.lock().map_err(err)?;

    let prefs = store
        .get_setting("preferences")
        .map_err(err)?
        .unwrap_or(json!({}));

    let automatic = prefs["provider"].as_str().unwrap_or("Automatic") == "Automatic";
    let managed_port = store
        .get_setting("setup.runtime_port")
        .map_err(err)?
        .and_then(|v| v.as_u64())
        .unwrap_or(11500);
    let managed_model = store
        .get_setting("setup.llm_tag")
        .map_err(err)?
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();
    let base_url = if automatic {
        format!("http://127.0.0.1:{managed_port}")
    } else {
        prefs["base_url"]
            .as_str()
            .unwrap_or("http://localhost:11434")
            .to_owned()
    };

    let secret_name = "llm".to_string();

    let config = match prefs["provider"].as_str().unwrap_or("Ollama") {
        "Anthropic" => ProviderConfig::Anthropic {
            base_url,
            secret_name,
        },
        "OpenAI" => ProviderConfig::OpenAI {
            base_url,
            secret_name,
        },
        "OpenAICompatible" => ProviderConfig::OpenAICompatible {
            base_url,
            secret_name: KeyringSecretStore
                .get(&secret_name)
                .map_err(err)?
                .map(|_| secret_name),
        },
        _ => ProviderConfig::Ollama { base_url },
    };

    Ok((
        talkkeeper_llm::build_provider(config, &KeyringSecretStore).map_err(err)?,
        if automatic {
            managed_model
        } else {
            prefs["model"].as_str().unwrap_or("").to_string()
        },
    ))
}

#[tauri::command]
async fn enhance_note(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    note_id: Uuid,
    template_id: String,
) -> Result<Value> {
    let (provider, model) = provider(&state)?;

    enhance_with_provider(
        &state,
        note_id,
        template_id,
        provider.as_ref(),
        model,
        |delta| {
            app.emit(
                "enhance://delta",
                json!({"note_id": note_id, "delta": delta}),
            )
            .map_err(err)
        },
    )
    .await
}

async fn enhance_with_provider(
    state: &AppState,
    note_id: Uuid,
    template_id: String,
    provider: &dyn talkkeeper_llm::LlmProvider,
    model: String,
    mut emit: impl FnMut(&str) -> Result<()> + Send,
) -> Result<Value> {
    if model.is_empty() {
        return Err("Choose a model in Settings".into());
    }

    let input = {
        let store = state.store.lock().map_err(err)?;

        let n = store
            .get_note(note_id)
            .map_err(err)?
            .ok_or("Note not found")?;

        let calendar = store.note_calendar_event(note_id).map_err(err)?;
        let allow = preferences(&store)?["calendar_details"] == true;
        let n = store.calendar_safe_note(n, allow).map_err(err)?;
        talkkeeper_templates::EnhanceInput {
            title: n.title,
            attendees: n.attendees.iter().map(|a| a.name.clone()).collect(),
            user_notes_markdown: n.notes_markdown,
            transcript: store
                .list_transcript_segments(note_id)
                .map_err(err)?
                .iter()
                .map(|s| talkkeeper_templates::Seg {
                    idx: s.seq as usize,
                    speaker: Some(s.speaker.to_string()),
                    start_ms: s.start_ms,
                    text: s.text.clone(),
                })
                .collect(),
            context_snippets: calendar
                .filter(|_| allow)
                .map(|e| {
                    vec![talkkeeper_templates::calendar_context(
                        &e.title,
                        &e.instance_start.to_rfc3339(),
                        &e.attendees
                            .iter()
                            .map(|a| a.name.clone())
                            .collect::<Vec<_>>(),
                    )]
                })
                .unwrap_or_default(),
        }
    };

    let template = templates(state)?
        .into_iter()
        .find(|t| t.id == template_id)
        .ok_or("Template not found")?;

    let request = |(system, user)| CompletionRequest {
        model: model.clone(),
        system,
        messages: vec![Message {
            role: Role::User,
            content: user,
        }],
        max_tokens: Some(4096),
        temperature: None,
    };
    let (images, image_context) =
        snapshots::snapshot_context(state, note_id, provider, &model).await?;
    let prompt = match talkkeeper_templates::plan_enhancement(&template, &input, 12000) {
        talkkeeper_templates::EnhancePlan::Direct { system, user } => (system, user),
        talkkeeper_templates::EnhancePlan::MapReduce {
            map_prompts,
            reduce_template,
            input,
        } => {
            let mut summaries = Vec::new();
            for prompt in map_prompts {
                summaries.push(provider.complete(request(prompt)).await.map_err(err)?.text);
            }
            talkkeeper_templates::build_reduce_prompt(&reduce_template, &input, &summaries)
        }
    };
    let (system, mut user) = prompt;
    user.push_str(&image_context);
    let mut stream = provider
        .stream_images(request((system, user)), images)
        .await
        .map_err(err)?;
    let mut text = String::new();
    while let Some(delta) = stream.next().await {
        let delta = delta.map_err(err)?;
        text.push_str(&delta);
        emit(&delta)?;
    }
    let mut store = state.store.lock().map_err(err)?;

    let mut note = store
        .get_note(note_id)
        .map_err(err)?
        .ok_or("Note not found")?;

    note.summary_markdown = Some(text.clone());

    note.template_id = Some(template_id);

    store.update_note(&note).map_err(err)?;

    Ok(json!({
    "text":text,"citations":talkkeeper_templates::parse_citations(&text)}
    ))
}

#[tauri::command]
async fn list_models(state: tauri::State<'_, AppState>) -> Result<Value> {
    let (p, _) = provider(&state)?;

    Ok(json!(p.list_models().await.map_err(err)?))
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<()> {
    let model = talkkeeper_transcribe::models::MODELS
        .iter()
        .find(|m| m.name == name)
        .ok_or("Unknown model")?;

    talkkeeper_transcribe::models::ModelManager::new(&state.directory)
        .download(model, move |downloaded, total| {
            let _ = app.emit(
                "model://progress",
                json!({
                "downloaded":downloaded,"total":total}
                ),
            );
        })
        .await
        .map_err(err)?;

    Ok(())
}

#[tauri::command]
fn start_note(state: tauri::State<'_, AppState>, title: Option<String>) -> Result<Note> {
    let note = Note::new(title.unwrap_or_else(|| "Untitled conversation".into()));
    state
        .store
        .lock()
        .map_err(err)?
        .create_note(&note)
        .map_err(err)?;
    Ok(note)
}

#[tauri::command]
fn data(state: tauri::State<'_, AppState>, action: String, payload: Value) -> Result<Value> {
    data_inner(&state, action, payload)
}

fn copy_text(state: &AppState, text: String) -> Result<()> {
    let mut clipboard = state.clipboard.lock().map_err(err)?;
    if clipboard.is_none() {
        *clipboard = Some(arboard::Clipboard::new().map_err(err)?);
    }
    clipboard.as_mut().unwrap().set_text(text).map_err(err)
}

fn preferences(store: &Store) -> Result<Value> {
    let mut defaults = json!({"provider":"Automatic","base_url":"http://localhost:11434","language":"auto","stt_engine":"local","snapshots_preference":"Ask each time","snapshot_retention":30,"retention":30,"vocabulary":[],"notice":"I would like to record and transcribe this conversation for my notes. Does everyone consent?"});
    if let Some(saved) = store.get_setting("preferences").map_err(err)? {
        if let Some(values) = saved.as_object() {
            defaults.as_object_mut().unwrap().extend(values.clone());
        }
    }
    if defaults["provider"] == "Automatic" {
        if let Some(model) = store.get_setting("setup.llm_tag").map_err(err)? {
            defaults["model"] = model;
        }
        if let Some(port) = store.get_setting("setup.runtime_port").map_err(err)? {
            if let Some(port) = port.as_u64() {
                defaults["base_url"] = json!(format!("http://127.0.0.1:{port}"));
            }
        }
    }
    Ok(defaults)
}

fn validate_settings(payload: &Value) -> Result<()> {
    for (key, value) in payload.as_object().ok_or("Expected settings")? {
        match key.as_str() {
            "provider"
                if [
                    "Automatic",
                    "Ollama",
                    "Anthropic",
                    "OpenAI",
                    "OpenAICompatible",
                ]
                .contains(&value.as_str().unwrap_or("")) => {}
            "stt_engine" if ["local", "cloud"].contains(&value.as_str().unwrap_or("")) => {}
            "snapshots_preference"
                if ["Ask each time", "Always on", "Never"]
                    .contains(&value.as_str().unwrap_or("")) => {}
            "calendar_details" | "calendar_reminders" | "calendar_auto_capture"
                if value.is_boolean() => {}
            "snapshot_retention" if value.as_u64().is_some_and(|n| n <= 36500) => {}
            "retention" if value.as_u64().is_some_and(|n| n <= 36500) => {}
            "vocabulary"
                if value.as_array().is_some_and(|a| {
                    a.len() <= 100
                        && a.iter()
                            .all(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
                }) => {}
            "calendar_email" | "base_url" | "stt_url" | "model" | "stt_model" | "language"
            | "notice"
                if value.is_string() => {}
            _ => return Err(format!("Invalid or unknown setting: {key}")),
        }
    }
    Ok(())
}

fn data_inner(state: &AppState, action: String, payload: Value) -> Result<Value> {
    let mut store = state.store.lock().map_err(err)?;
    let id = || Uuid::parse_str(payload["id"].as_str().unwrap_or("")).map_err(err);
    if action == "snapshots" || action.starts_with("snapshot_") {
        return snapshots::data(&mut store, &action, payload);
    }
    if action.starts_with("calendar_") {
        return calendar::data(state, &mut store, &action, payload);
    }
    match action.as_str() {
        "people" => Ok(json!(store.list_people().map_err(err)?)),
        "companies" => Ok(json!(store.list_companies().map_err(err)?)),
        "person_meetings" => Ok(json!(store.person_meetings(id()?).map_err(err)?)),
        "company_meetings" => Ok(json!(store.company_meetings(id()?).map_err(err)?)),
        "can_undo_people_merge" => Ok(json!(store.can_undo_people_merge().map_err(err)?)),
        "duplicates" => Ok(json!(store.duplicate_people().map_err(err)?)),
        "save_person" => {
            store
                .update_person(&serde_json::from_value(payload).map_err(err)?)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "merge_people" => {
            store
                .merge_people(
                    id()?,
                    Uuid::parse_str(payload["remove"].as_str().unwrap_or("")).map_err(err)?,
                )
                .map_err(err)?;
            Ok(Value::Null)
        }
        "undo_people_merge" => {
            store.undo_people_merge().map_err(err)?;
            Ok(Value::Null)
        }
        "start_note" => {
            let note = Note::new(payload["title"].as_str().unwrap_or("Untitled conversation"));
            store.create_note(&note).map_err(err)?;
            Ok(json!(note))
        }
        "get" => Ok(json!(store.get_note(id()?).map_err(err)?)),
        "list" => Ok(json!(store.list_notes().map_err(err)?)),
        "trash" => Ok(json!(store.list_trash().map_err(err)?)),
        "search" => {
            let hits = store
                .search(
                    payload["query"].as_str().unwrap_or(""),
                    &SearchFilters::default(),
                    100,
                )
                .map_err(err)?;
            Ok(json!(hits
                .into_iter()
                .map(|h| json!({"note":h.note,"snippet":h.snippet}))
                .collect::<Vec<_>>()))
        }
        "update" => {
            let note: Note = serde_json::from_value(payload).map_err(err)?;
            store.update_note(&note).map_err(err)?;
            Ok(json!(note))
        }
        "delete" | "restore" | "purge" => {
            match action.as_str() {
                "delete" => store.trash_note(id()?),
                "restore" => store.restore_note(id()?),
                _ => store.purge_note(id()?),
            }
            .map_err(err)?;
            Ok(Value::Null)
        }
        "chat_history" => Ok(json!(store.chat_history(id()?).map_err(err)?)),
        "clear_chat" => {
            store.clear_chat(id()?).map_err(err)?;
            Ok(Value::Null)
        }
        "versions" => Ok(json!(store.summary_versions(id()?).map_err(err)?)),
        "apply_revision" | "discard_revision" | "restore_summary" => {
            let note_id = id()?;
            let edit = Uuid::parse_str(payload["edit"].as_str().ok_or("Missing revision id")?)
                .map_err(err)?;
            match action.as_str() {
                "apply_revision" => store.apply_revision(note_id, edit),
                "discard_revision" => store.discard_revision(note_id, edit),
                _ => store.restore_summary(note_id, edit),
            }
            .map_err(err)?;
            Ok(json!(store.get_note(note_id).map_err(err)?))
        }
        "copy_text" => {
            copy_text(
                state,
                payload["text"].as_str().ok_or("Missing text")?.into(),
            )?;
            Ok(Value::Null)
        }
        "segments" => Ok(json!(store.list_transcript_segments(id()?).map_err(err)?)),
        "delete_segments" => {
            let ids: Vec<Uuid> = serde_json::from_value(payload["ids"].clone()).map_err(err)?;
            Ok(json!(store
                .delete_transcript_segments(id()?, &ids)
                .map_err(err)?))
        }
        "speech_models" => Ok(json!(talkkeeper_transcribe::models::MODELS
            .iter()
            .map(|m| json!({"name":m.name,"size":m.size}))
            .collect::<Vec<_>>())),
        "folders" => Ok(json!(store.list_folders().map_err(err)?)),
        "save_folder" => {
            let folder = serde_json::from_value(payload["folder"].clone()).map_err(err)?;
            if payload["update"] == true {
                store.update_folder(&folder)
            } else {
                store.create_folder(&folder)
            }
            .map_err(err)?;
            Ok(Value::Null)
        }
        "delete_folder" => {
            store.delete_folder(id()?).map_err(err)?;
            Ok(Value::Null)
        }
        "settings" => preferences(&store),
        "save_settings" => {
            validate_settings(&payload)?;
            store.set_setting("preferences", &payload).map_err(err)?;
            Ok(Value::Null)
        }
        "set_key" | "clear_key" => {
            let name = payload["name"].as_str().unwrap_or("llm");
            if !["llm", "stt"].contains(&name) {
                return Err("Unknown credential".into());
            }
            if action == "set_key" {
                KeyringSecretStore.set(name, payload["key"].as_str().ok_or("Missing key")?)
            } else {
                KeyringSecretStore.delete(name)
            }
            .map_err(err)?;
            Ok(Value::Null)
        }
        "templates" => Ok(json!(templates(state)?)),
        "save_template" | "delete_template" => {
            let mut all = templates(state)?;
            let mut template: talkkeeper_templates::Template =
                serde_json::from_value(payload).map_err(err)?;
            if template.id.trim().is_empty() || template.name.trim().is_empty() {
                return Err("Template id and name are required".into());
            }
            if all.iter().any(|t| t.id == template.id && t.built_in) {
                return Err("Built-in templates are read only".into());
            }
            all.retain(|t| !t.built_in && t.id != template.id);
            if action == "save_template" {
                template.built_in = false;
                all.push(template);
            }
            let path = state.directory.join("templates.json");
            let temporary = path.with_extension("tmp");
            std::fs::write(&temporary, serde_json::to_vec_pretty(&all).map_err(err)?)
                .map_err(err)?;
            std::fs::rename(temporary, path).map_err(err)?;
            Ok(Value::Null)
        }
        "notice" => Ok(preferences(&store)?["notice"].clone()),
        "copy_notice" => {
            copy_text(
                state,
                preferences(&store)?["notice"].as_str().unwrap_or("").into(),
            )?;
            Ok(Value::Null)
        }
        "export" => {
            let format = payload["format"].as_str().unwrap_or("markdown");
            let text = match format {
                "transcript" => store.export_transcript_text(id()?).map_err(err)?,
                "csv" => {
                    let mut bytes = vec![];
                    store.export_all_csv(&mut bytes).map_err(err)?;
                    String::from_utf8(bytes).map_err(err)?
                }
                "summary" => store
                    .get_note(id()?)
                    .map_err(err)?
                    .ok_or("Note not found")?
                    .summary_markdown
                    .unwrap_or_default(),
                _ => store.export_note_markdown(id()?).map_err(err)?,
            };
            // Release SQLite before opening a native dialog.
            drop(store);
            if payload["copy"] == true {
                copy_text(state, text.clone())?;
            } else if payload["save"] == true {
                if let Some(path) = rfd::FileDialog::new()
                    .set_file_name(if format == "csv" {
                        "notes.csv"
                    } else {
                        "note.md"
                    })
                    .save_file()
                {
                    std::fs::write(path, &text).map_err(err)?;
                }
            }
            Ok(json!(text))
        }
        _ => workspace::data(&mut store, &action, payload),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(dictation::shortcut)
                .build(),
        )
        .setup(|app| {
            let directory = app.path().app_data_dir()?;

            std::fs::create_dir_all(&directory)?;

            let mut store = Store::open(directory.join("talkkeeper.sqlite"))?;

            let days = preferences(&store).map_err(std::io::Error::other)?["retention"]
                .as_u64()
                .unwrap_or(30);
            store.apply_transcript_retention(days.min(36500) as u32)?;
            let snapshot_days = preferences(&store).map_err(std::io::Error::other)?
                ["snapshot_retention"]
                .as_u64()
                .unwrap_or(30);
            store.apply_snapshot_retention(snapshot_days.min(36500) as u32)?;

            app.manage(AppState {
                store: Arc::new(Mutex::new(store)),
                directory,
                capture: Mutex::new(None),
                snapshots: Mutex::new(snapshots::SnapshotSession::default()),
                clipboard: Mutex::new(None),
            });

            app.manage(dictation::VoiceState::default());
            dictation::initialize(app.handle());
            app.manage(setup::SetupState::default());
            setup::resume(app.handle().clone());
            calendar::initialize(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            calendar::calendar_data,
            data,
            dictation::dictation_data,
            dictation::dictation_control,
            workspace::ask_workspace,
            setup::setup_status,
            setup::setup_plan,
            setup::setup_run,
            setup::setup_cancel,
            people::recent_topics,
            start_note,
            enhance_note,
            chat::chat_note,
            list_models,
            download_model,
            snapshots::snapshot_control,
            snapshots::snapshot_ai_status,
            session::start_capture,
            session::pause_capture,
            session::resume_capture,
            session::stop_capture
        ])
        .build(tauri::generate_context!())
        .expect("failed to build TalkKeeper desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                setup::shutdown(app);
            }
        });
}

#[cfg(test)]
mod tests {

    use super::*;

    pub(super) fn state() -> AppState {
        AppState {
            store: Arc::new(Mutex::new(Store::open_in_memory().unwrap())),
            directory: std::env::temp_dir().join(Uuid::new_v4().to_string()),
            capture: Mutex::new(None),
            snapshots: Mutex::new(snapshots::SnapshotSession::default()),
            clipboard: Mutex::new(None),
        }
    }

    #[test]
    fn note_commands_keep_search_and_trash_consistent() {
        let s = state();

        let mut n = data_inner(
            &s,
            "start_note".into(),
            json!({
            "title":"Planning"}
            ),
        )
        .unwrap();

        n["notes_markdown"] = json!("Plant herbs in spring");

        data_inner(&s, "update".into(), n.clone()).unwrap();

        let hits = data_inner(
            &s,
            "search".into(),
            json!({
            "query":"herbs"}
            ),
        )
        .unwrap();

        assert_eq!(hits.as_array().unwrap().len(), 1);

        data_inner(
            &s,
            "delete".into(),
            json!({
            "id":n["id"]}
            ),
        )
        .unwrap();

        assert!(data_inner(&s, "list".into(), json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());

        data_inner(
            &s,
            "restore".into(),
            json!({
            "id":n["id"]}
            ),
        )
        .unwrap();

        assert_eq!(
            data_inner(&s, "list".into(), json!({}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    pub(super) struct MockProvider;
    #[async_trait::async_trait]
    impl talkkeeper_llm::LlmProvider for MockProvider {
        fn id(&self) -> &str {
            "test"
        }
        async fn list_models(&self) -> talkkeeper_llm::Result<Vec<talkkeeper_llm::ModelInfo>> {
            Ok(vec![])
        }
        async fn complete(
            &self,
            _: CompletionRequest,
        ) -> talkkeeper_llm::Result<talkkeeper_llm::CompletionResponse> {
            Ok(talkkeeper_llm::CompletionResponse {
                text: "Mapped notes".into(),
                usage: None,
            })
        }
        async fn stream(
            &self,
            request: CompletionRequest,
        ) -> talkkeeper_llm::Result<talkkeeper_llm::TokenStream> {
            assert_eq!(request.model, "user-selected");
            assert!(request
                .messages
                .last()
                .unwrap()
                .content
                .contains("Planning"));
            Ok(Box::pin(futures_util::stream::iter(vec![
                Ok("## Decisions\n".into()),
                Ok("Plant herbs [#1]".into()),
            ])))
        }
    }
    #[tokio::test]
    async fn enhancement_streams_persists_and_returns_citations() {
        let state = state();
        let note = Note::new("Planning");
        state.store.lock().unwrap().create_note(&note).unwrap();
        let mut deltas = vec![];
        let result = enhance_with_provider(
            &state,
            note.id,
            "auto".into(),
            &MockProvider,
            "user-selected".into(),
            |delta| {
                deltas.push(delta.to_string());
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(deltas.len(), 2);
        assert_eq!(result["citations"][0][1], json!([1]));
        let saved = state
            .store
            .lock()
            .unwrap()
            .get_note(note.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            saved.summary_markdown.as_deref(),
            Some("## Decisions\nPlant herbs [#1]")
        );
        assert_eq!(saved.template_id.as_deref(), Some("auto"));
    }

    #[test]
    fn settings_reject_credentials() {
        let s = state();

        assert!(data_inner(
            &s,
            "save_settings".into(),
            json!({
            "api_key":"must not persist"}
            )
        )
        .is_err());

        assert!(s
            .store
            .lock()
            .unwrap()
            .get_setting("preferences")
            .unwrap()
            .is_none());
    }
}
