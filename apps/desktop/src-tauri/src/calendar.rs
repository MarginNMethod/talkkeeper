use super::*;
use chrono::{Duration, Utc};
use talkkeeper_core::{CalendarEvent, CalendarSource};
fn key(id: &str) -> String {
    format!("calendar/{id}")
}
fn expand(state: &AppState, text: &str, id: &str) -> Result<Vec<CalendarEvent>> {
    let email = preferences(&*state.store.lock().map_err(err)?)?["calendar_email"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    talkkeeper_calendar::events_between_for_user(
        text,
        id,
        Utc::now() - Duration::days(1),
        Utc::now() + Duration::days(120),
        rrule_zone(),
        Some(&email),
    )
    .map_err(err)
}
fn rrule_zone() -> talkkeeper_calendar::LocalZone {
    talkkeeper_calendar::local_zone()
}
fn cache_path(state: &AppState, id: &str) -> Result<PathBuf> {
    let id = Uuid::parse_str(id).map_err(|_| "Invalid calendar source")?;
    Ok(state.directory.join(format!("calendar-{id}.ics")))
}
fn save_cache(state: &AppState, id: &str, text: &str) -> Result<()> {
    let path = cache_path(state, id)?;
    let temporary = path.with_extension("ics.tmp");
    std::fs::write(&temporary, text).map_err(|_| "Cannot save calendar cache")?;
    std::fs::rename(temporary, path).map_err(|_| "Cannot save calendar cache".to_string())
}
async fn refresh(state: &AppState, source: CalendarSource) -> Result<()> {
    refresh_with_secrets(state, source, &KeyringSecretStore).await
}
async fn refresh_with_secrets(
    state: &AppState,
    mut source: CalendarSource,
    secrets: &dyn SecretStore,
) -> Result<()> {
    let result = async {
        let url = secrets.get(&key(&source.id)).map_err(err)?;
        let fetched = if let Some(url) = url {
            Some(
                talkkeeper_calendar::fetch(
                    &url,
                    source.etag.as_deref(),
                    source.last_modified.as_deref(),
                )
                .await
                .map_err(err)?,
            )
        } else {
            None
        };
        let text = if let Some(text) = fetched.as_ref().and_then(|f| f.text.as_ref()) {
            text.clone()
        } else {
            talkkeeper_calendar::import_file(&cache_path(state, &source.id)?).map_err(err)?
        };
        let events = expand(state, &text, &source.id)?;
        let mut store = state.store.lock().map_err(err)?;
        if !store
            .calendar_sources()
            .map_err(err)?
            .iter()
            .any(|s| s.id == source.id)
        {
            return Ok(());
        }
        save_cache(state, &source.id, &text)?;
        store
            .replace_calendar_events(&source.id, &events)
            .map_err(err)?;
        if let Some(fetched) = fetched {
            source.etag = fetched.etag.or(source.etag.take());
            source.last_modified = fetched.last_modified.or(source.last_modified.take());
        }
        source.last_synced_at = Some(Utc::now().to_rfc3339());
        Ok::<_, String>(())
    }
    .await;
    let mut store = state.store.lock().map_err(err)?;
    if let Some(mut current) = store
        .calendar_sources()
        .map_err(err)?
        .into_iter()
        .find(|s| s.id == source.id)
    {
        current.last_error = result.as_ref().err().cloned();
        current.last_synced_at = source.last_synced_at;
        current.etag = source.etag;
        current.last_modified = source.last_modified;
        store.save_calendar_source(&current).map_err(err)?;
    }
    result
}
#[tauri::command]
pub async fn calendar_data(
    state: tauri::State<'_, AppState>,
    action: String,
    payload: Value,
) -> Result<Value> {
    match action.as_str() {
        "test" | "add" => {
            let raw = payload["url"].as_str().ok_or("Enter a calendar link")?;
            let url = talkkeeper_calendar::normalize_url(raw).map_err(err)?;
            let fetched = talkkeeper_calendar::fetch(raw, None, None)
                .await
                .map_err(err)?;
            let id = Uuid::new_v4().to_string();
            let events = expand(&state, fetched.text.as_deref().unwrap_or(""), &id)?;
            if action == "test" {
                return Ok(json!({"count":events.len(),"insecure":url.scheme()=="http"}));
            }
            let source = CalendarSource {
                id: id.clone(),
                name: payload["name"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(url.host_str().unwrap_or("Calendar"))
                    .into(),
                color: payload["color"].as_str().unwrap_or("#537cad").into(),
                enabled: true,
                sync_minutes: 15,
                last_synced_at: Some(Utc::now().to_rfc3339()),
                last_error: None,
                etag: fetched.etag,
                last_modified: fetched.last_modified,
            };
            save_cache(&state, &id, fetched.text.as_deref().unwrap_or(""))?;
            KeyringSecretStore.set(&key(&id), raw).map_err(err)?;
            let mut store = state.store.lock().map_err(err)?;
            store.save_calendar_source(&source).map_err(err)?;
            store.replace_calendar_events(&id, &events).map_err(err)?;
            Ok(json!(source))
        }
        "refresh" => {
            let sources = state
                .store
                .lock()
                .map_err(err)?
                .calendar_sources()
                .map_err(err)?;
            for s in sources
                .into_iter()
                .filter(|s| s.enabled && payload["id"].as_str().is_none_or(|id| s.id == id))
            {
                refresh(&state, s).await?;
            }
            Ok(Value::Null)
        }
        "import" => {
            let path = tauri::async_runtime::spawn_blocking(|| {
                rfd::FileDialog::new()
                    .add_filter("Calendar", &["ics"])
                    .pick_file()
            })
            .await
            .map_err(err)?;
            let Some(path) = path else {
                return Ok(Value::Null);
            };
            let text = talkkeeper_calendar::import_file(&path).map_err(err)?;
            let id = Uuid::new_v4().to_string();
            let events = expand(&state, &text, &id)?;
            save_cache(&state, &id, &text)?;
            let source = CalendarSource {
                id: id.clone(),
                name: "Imported calendar".into(),
                color: "#537cad".into(),
                enabled: true,
                sync_minutes: 15,
                last_synced_at: Some(Utc::now().to_rfc3339()),
                last_error: None,
                etag: None,
                last_modified: None,
            };
            let mut store = state.store.lock().map_err(err)?;
            store.save_calendar_source(&source).map_err(err)?;
            store.replace_calendar_events(&id, &events).map_err(err)?;
            Ok(json!(source))
        }
        _ => Err("Unknown calendar operation".into()),
    }
}
pub fn data(state: &AppState, store: &mut Store, action: &str, p: Value) -> Result<Value> {
    match action {
        "calendar_sources" => Ok(json!(store.calendar_sources().map_err(err)?)),
        "calendar_events" => {
            let events = store.calendar_events().map_err(err)?;
            let mut out = vec![];
            for e in events {
                let note = store.calendar_note(&e).map_err(err)?;
                out.push(json!({"event":e,"note_id":note.map(|n|n.id)}));
            }
            Ok(json!(out))
        }
        "calendar_save" => {
            let s: CalendarSource = serde_json::from_value(p).map_err(err)?;
            store.save_calendar_source(&s).map_err(err)?;
            Ok(Value::Null)
        }
        "calendar_remove" => {
            let id = p["id"].as_str().ok_or("Missing source")?;
            KeyringSecretStore.delete(&key(id)).map_err(err)?;
            store.remove_calendar_source(id).map_err(err)?;
            if let Ok(path) = cache_path(state, id) {
                let _ = std::fs::remove_file(path);
            }
            Ok(Value::Null)
        }
        "calendar_start" | "calendar_link" => {
            let e: CalendarEvent = serde_json::from_value(p["event"].clone()).map_err(err)?;
            let e = store
                .calendar_events()
                .map_err(err)?
                .into_iter()
                .find(|x| {
                    x.source_id == e.source_id
                        && x.uid == e.uid
                        && x.instance_start == e.instance_start
                })
                .ok_or("Event is unavailable")?;
            if action == "calendar_link" {
                store
                    .link_calendar_note(
                        Uuid::parse_str(p["id"].as_str().unwrap_or("")).map_err(err)?,
                        &e,
                    )
                    .map_err(err)?;
                Ok(Value::Null)
            } else {
                Ok(json!(store.start_calendar_note(&e).map_err(err)?))
            }
        }
        "calendar_note" => Ok(json!(store
            .note_calendar_event(Uuid::parse_str(p["id"].as_str().unwrap_or("")).map_err(err)?)
            .map_err(err)?)),
        _ => Err("Unknown calendar action".into()),
    }
}
pub fn initialize(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut startup = true;
        loop {
            let state = app.state::<AppState>();
            let sources = state
                .store
                .lock()
                .ok()
                .and_then(|s| s.calendar_sources().ok())
                .unwrap_or_default();
            for source in sources {
                if talkkeeper_calendar::refresh_due(&source, Utc::now(), startup) {
                    let _ = refresh(&state, source).await;
                }
            }
            startup = false;
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn refresh_preserves_last_good_copy_and_keeps_address_in_secret_store() {
        let state = crate::tests::state();
        std::fs::create_dir_all(&state.directory).unwrap();
        let id = Uuid::new_v4().to_string();
        let source = CalendarSource {
            id: id.clone(),
            name: "Local meetings".into(),
            color: "#537cad".into(),
            enabled: true,
            sync_minutes: 15,
            last_synced_at: None,
            last_error: None,
            etag: None,
            last_modified: None,
        };
        state
            .store
            .lock()
            .unwrap()
            .save_calendar_source(&source)
            .unwrap();
        let date = Utc::now().format("%Y%m%dT%H%M%SZ");
        save_cache(&state,&id,&format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:original\r\nDTSTART:{date}\r\nSUMMARY:Local planning\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")).unwrap();
        let secrets = talkkeeper_llm::InMemorySecretStore::default();
        refresh_with_secrets(&state, source, &secrets)
            .await
            .unwrap();
        let good = state
            .store
            .lock()
            .unwrap()
            .calendar_sources()
            .unwrap()
            .remove(0);
        assert!(good.last_synced_at.is_some());
        secrets
            .set(&key(&id), "file:///private-calendar-secret")
            .unwrap();
        assert!(refresh_with_secrets(&state, good.clone(), &secrets)
            .await
            .is_err());
        let store = state.store.lock().unwrap();
        let failed = store.calendar_sources().unwrap().remove(0);
        assert_eq!(failed.last_synced_at, good.last_synced_at);
        assert!(failed.last_error.is_some());
        assert_eq!(store.calendar_events().unwrap().len(), 1);
        assert!(!serde_json::to_string(&failed)
            .unwrap()
            .contains("private-calendar-secret"));
        drop(store);
        std::fs::remove_dir_all(&state.directory).unwrap();
    }
}
