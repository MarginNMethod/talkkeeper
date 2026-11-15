use super::*;
use talkkeeper_setup::{CancellationToken, OllamaRuntime, Plan, Setup};
#[derive(Default)]
pub struct SetupState {
    runtime: Mutex<Option<OllamaRuntime>>,
    cancel: Mutex<Option<CancellationToken>>,
    queue: tokio::sync::Mutex<()>,
    progress: Mutex<std::collections::BTreeMap<String, talkkeeper_setup::Progress>>,
}
#[tauri::command]
pub fn setup_status(state: tauri::State<'_, AppState>) -> Result<Value> {
    let store = state.store.lock().map_err(err)?;
    let completed = store.get_setting("setup.completed").map_err(err)? == Some(json!(true));
    let custom = preferences(&store)?["provider"]
        .as_str()
        .is_some_and(|p| p != "Automatic");
    let pending = store
        .get_setting("setup.pending_plan")
        .map_err(err)?
        .is_some();
    let speech = store.get_setting("setup.speech_ready").map_err(err)? == Some(json!(true));
    let stage = store
        .get_setting("setup.stage")
        .map_err(err)?
        .unwrap_or(Value::Null);
    let failed = store
        .get_setting("setup.last_error")
        .map_err(err)?
        .is_some_and(|v| !v.is_null());
    let skipped = store.get_setting("setup.ai_skipped").map_err(err)? == Some(json!(true));
    Ok(
        json!({"notes":true, "completed":completed, "custom":custom, "pending":pending,
        "paused":store.get_setting("setup.paused").map_err(err)? == Some(json!(true)),
        "card_dismissed":store.get_setting("setup.card_dismissed").map_err(err)? == Some(json!(true)),
        "quit_confirmed":store.get_setting("setup.quit_confirmed").map_err(err)? == Some(json!(true)),
        "mic_checked":store.get_setting("setup.mic_checked").map_err(err)? == Some(json!(true)),
        "speech":if speech || completed {"ready"} else if failed {"failed"} else if pending {"downloading"} else {"missing"},
        "ai":if custom {"custom"} else if skipped {"skipped"} else if completed {"ready"} else if failed {"failed"} else if stage == json!("Verify") {"checking"} else if pending {"downloading"} else {"missing"}}),
    )
}
#[tauri::command]
pub fn setup_plan(state: tauri::State<'_, AppState>) -> Result<Plan> {
    let store = state.store.lock().map_err(err)?;
    if store.get_setting("setup.completed").map_err(err)? != Some(json!(true)) {
        if let Some(saved) = store.get_setting("setup.pending_plan").map_err(err)? {
            if let Ok(mut plan) = serde_json::from_value::<Plan>(saved) {
                plan.hardware =
                    talkkeeper_setup::Hardware::detect(&state.directory).map_err(err)?;
                // The entrypoint rechecks remaining storage, accounting for verified files.
                plan.can_install = true;
                return Ok(plan);
            }
        }
    }
    Setup::new(&state.directory).plan().map_err(err)
}
#[tauri::command]
pub async fn setup_cancel(
    state: tauri::State<'_, SetupState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<()> {
    app_state
        .store
        .lock()
        .map_err(err)?
        .set_setting("setup.paused", &json!(true))
        .map_err(err)?;
    if let Some(token) = state.cancel.lock().map_err(err)?.as_ref() {
        token.cancel();
    }
    loop {
        if state.cancel.lock().map_err(err)?.is_none() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Ok(())
}
#[tauri::command]
pub async fn setup_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    setup: tauri::State<'_, SetupState>,
) -> Result<()> {
    let token = CancellationToken::new();
    {
        let mut running = setup.cancel.lock().map_err(err)?;
        if running.is_some() {
            return Ok(());
        }
        *running = Some(token.clone());
    }
    let result = async {
        // Drop a previous managed child before starting again; external engines
        // are never stopped. All selected identifiers originate in the catalog.
        setup.runtime.lock().map_err(err)?.take();
        state
            .store
            .lock()
            .map_err(err)?
            .set_setting("setup.paused", &json!(false))
            .map_err(err)?;
        state.store.lock().map_err(err)?.set_setting("setup.last_error", &Value::Null).map_err(err)?;
        let service = Setup::new(&state.directory);
        let plan = setup_plan(state.clone())?;
        state
            .store
            .lock()
            .map_err(err)?
            .set_setting("setup.pending_plan", &json!(plan))
            .map_err(err)?;
        let report = |p: talkkeeper_setup::Progress| {
                    if let Err(error) = record_speech_ready(&state.store, &plan.whisper.model, &p) {
                        let _ = app.emit("setup://error", error);
                        return;
                    }
                    if p.stage == talkkeeper_setup::Stage::SpeechReady {
                        let _ = app.emit("setup://unlocked", "speech");
                    }
                    if let Ok(mut latest) = setup.progress.lock() {
                        latest.insert(format!("{:?}", p.stage), p.clone());
                    }
                    if let Ok(mut store) = state.store.lock() {
                        let _ = store.set_setting("setup.stage", &json!(p.stage));
                        if let Ok(latest) = setup.progress.lock() { let _ = store.set_setting("setup.progress", &json!(*latest)); }
                    }
                    let _ = app.emit("setup://progress", p);
                };
        let custom = preferences(&*state.store.lock().map_err(err)?)?["provider"].as_str().is_some_and(|p| p != "Automatic");
        let skipped = state.store.lock().map_err(err)?.get_setting("setup.ai_skipped").map_err(err)? == Some(json!(true));
        if custom || skipped {
            let mut attempt = 0;
            loop {
                let result = tokio::select! {
                    _ = token.cancelled() => return Ok(()),
                    result = service.download_speech(&plan, &report) => result,
                };
                match result {
                    Ok(()) => { drain_queue(&app).await?; return Ok(()); },
                    Err(error @ (talkkeeper_setup::Error::Offline | talkkeeper_setup::Error::Checksum)) => {
                        let message = if matches!(error,talkkeeper_setup::Error::Offline) { "Waiting for the internet. Your download is saved and will carry on by itself." } else { "The download was damaged. We'll fetch that part again. Nothing else is lost." };
                        report(talkkeeper_setup::Progress::new(talkkeeper_setup::Stage::Check, 0, 0, message));
                        tokio::select! {
                            _ = token.cancelled() => return Ok(()),
                            _ = tokio::time::sleep(std::time::Duration::from_secs([5,15,60][attempt.min(2)])) => {},
                        }
                        attempt += 1;
                    }
                    Err(error) => return Err(err(error)),
                }
            }
        }
        let runtime = service.run_setup(&plan, report, token)
            .await
            .map_err(err)?;
        let port = reqwest_port(&runtime.base_url)?;
        {
            let mut store = state.store.lock().map_err(err)?;
            store
                .set_setting("setup.llm_tag", &json!(plan.llm.ollama_tag))
                .map_err(err)?;
            store
                .set_setting("setup.whisper_model", &json!(plan.whisper.model))
                .map_err(err)?;
            store
                .set_setting("setup.runtime_port", &json!(port))
                .map_err(err)?;
            // Speech capture consumes preferences through the existing session API.
            let mut prefs = preferences(&store)?;
            if prefs["provider"].is_null() {
                prefs["provider"] = json!("Automatic");
            }
            prefs["stt_engine"] = json!("local");
            prefs["stt_model"] = json!(plan.whisper.model);
            store.set_setting("preferences", &prefs).map_err(err)?;
            store
                .set_setting("setup.completed", &json!(true))
                .map_err(err)?;
        }
        let _ = app.emit("setup://unlocked", "ai");
        *setup.runtime.lock().map_err(err)? = Some(runtime);
        drain_queue(&app).await?;
        Ok(())
    }
    .await;
    setup.cancel.lock().map_err(err)?.take();
    if let Err(error) = &result {
        if !error.contains("paused") {
            state
                .store
                .lock()
                .map_err(err)?
                .set_setting("setup.last_error", &json!(error))
                .map_err(err)?;
            let _ = app.emit("setup://error", error);
        }
    }
    result
}
fn reqwest_port(base: &str) -> Result<u16> {
    base.rsplit(':')
        .next()
        .ok_or("Missing engine port")?
        .parse()
        .map_err(err)
}
pub fn resume(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let complete = state
            .store
            .lock()
            .ok()
            .and_then(|s| s.get_setting("setup.completed").ok().flatten())
            .is_some_and(|v| v == true);
        if !complete {
            let pending = state
                .store
                .lock()
                .ok()
                .is_some_and(|store| should_resume(&store));
            if pending {
                if let Err(error) = setup_run(app.clone(), state, app.state::<SetupState>()).await {
                    let _ = app.emit("setup://error", error);
                }
            }
            return;
        }
        if let Ok(mut store) = state.store.lock() {
            let _ = store.set_setting("setup.card_dismissed", &json!(true));
        }
        match Setup::new(&state.directory).resume_runtime().await {
            Ok(runtime) => {
                if let Ok(port) = reqwest_port(&runtime.base_url) {
                    if let Ok(mut store) = state.store.lock() {
                        let _ = store.set_setting("setup.runtime_port", &json!(port));
                    }
                }
                if let Ok(mut owned) = app.state::<SetupState>().runtime.lock() {
                    *owned = Some(runtime);
                }
            }
            Err(e) => {
                let _ = app.emit("setup://error", e.to_string());
            }
        }
        let _ = drain_queue(&app).await;
    });
}

pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<SetupState>();
    if let Ok(cancel) = state.cancel.lock() {
        if let Some(token) = cancel.as_ref() {
            token.cancel();
        }
    }
    if let Ok(mut runtime) = state.runtime.lock() {
        runtime.take();
    };
}

fn record_speech_ready(
    store: &Mutex<Store>,
    model: &str,
    progress: &talkkeeper_setup::Progress,
) -> Result<()> {
    // Verify starts only after the downloaded speech model passes integrity checks.
    if progress.stage != talkkeeper_setup::Stage::SpeechReady {
        return Ok(());
    }
    let mut store = store.lock().map_err(err)?;
    let mut prefs = preferences(&store)?;
    prefs["stt_engine"] = json!("local");
    prefs["stt_model"] = json!(model);
    store.set_setting("preferences", &prefs).map_err(err)?;
    store
        .set_setting("setup.speech_ready", &json!(true))
        .map_err(err)
}
#[cfg(test)]
mod recording_tests {
    use super::*;
    #[test]
    fn speech_preferences_survive_later_setup_failure() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("setup.sqlite");
        let store = Mutex::new(Store::open(&path).unwrap());
        store
            .lock()
            .unwrap()
            .set_setting("preferences", &json!({"language":"fr"}))
            .unwrap();
        let result: Result<()> = (|| {
            record_speech_ready(
                &store,
                "base",
                &talkkeeper_setup::Progress::new(
                    talkkeeper_setup::Stage::DownloadSpeechModel,
                    1,
                    1,
                    "Downloading",
                ),
            )?;
            assert!(preferences(&store.lock().unwrap())?["stt_model"].is_null());
            record_speech_ready(
                &store,
                "base",
                &talkkeeper_setup::Progress::new(
                    talkkeeper_setup::Stage::SpeechReady,
                    1,
                    1,
                    "Verifying",
                ),
            )?;
            Err("AI verification failed".into())
        })();
        assert!(result.is_err());
        drop(store);
        let store = Store::open(&path).unwrap();
        let prefs = preferences(&store).unwrap();
        assert_eq!(prefs["stt_model"], "base");
        assert_eq!(prefs["stt_engine"], "local");
        assert_eq!(prefs["language"], "fr");
        assert_ne!(
            store.get_setting("setup.completed").unwrap(),
            Some(json!(true))
        );
    }
}

#[tauri::command]
pub fn setup_progress(
    state: tauri::State<'_, SetupState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Value> {
    if state.progress.lock().map_err(err)?.is_empty() {
        if let Some(saved) = app_state
            .store
            .lock()
            .map_err(err)?
            .get_setting("setup.progress")
            .map_err(err)?
        {
            *state.progress.lock().map_err(err)? = serde_json::from_value(saved).map_err(err)?;
        }
    }
    Ok(
        json!({"running": state.cancel.lock().map_err(err)?.is_some(), "progress": *state.progress.lock().map_err(err)?}),
    )
}
#[tauri::command]
pub fn setup_mic_checked(state: tauri::State<'_, AppState>) -> Result<()> {
    state
        .store
        .lock()
        .map_err(err)?
        .set_setting("setup.mic_checked", &json!(true))
        .map_err(err)
}

#[tauri::command]
pub async fn setup_test_provider(prefs: Value, key: String) -> Result<Value> {
    let secrets = talkkeeper_llm::InMemorySecretStore::default();
    if !key.is_empty() {
        secrets.set("test", &key).map_err(err)?;
    }
    let base_url = prefs["base_url"]
        .as_str()
        .ok_or("Missing address")?
        .to_owned();
    let config = match prefs["provider"].as_str() {
        Some("Anthropic") => ProviderConfig::Anthropic {
            base_url,
            secret_name: "test".into(),
        },
        Some("OpenAI") => ProviderConfig::OpenAI {
            base_url,
            secret_name: "test".into(),
        },
        Some("OpenAICompatible") => ProviderConfig::OpenAICompatible {
            base_url,
            secret_name: (!key.is_empty()).then(|| "test".into()),
        },
        _ => ProviderConfig::Ollama { base_url },
    };
    let provider = talkkeeper_llm::build_provider(config, &secrets).map_err(err)?;
    Ok(json!(provider.list_models().await.map_err(err)?))
}

#[tauri::command]
pub async fn setup_check_microphone(app: tauri::AppHandle) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(err)?
            .block_on(check_microphone(app))
    })
    .await
    .map_err(err)?
}
async fn check_microphone(app: tauri::AppHandle) -> Result<String> {
    let state = app.state::<AppState>();
    if state.capture.lock().map_err(err)?.is_some() {
        return Err("A recording is in progress".into());
    }
    if tokio::task::spawn_blocking(talkkeeper_audio::authorize_microphone)
        .await
        .map_err(err)?
        .is_err()
    {
        return Ok("denied".into());
    }
    let prefs = preferences(&*state.store.lock().map_err(err)?)?;
    let engine = session::speech_engine(&state, &prefs).await?;
    let mut stt = session::begin_transcription(engine.as_ref(), &prefs).await?;
    let mut events = stt.events().ok_or("No speech events")?;
    let device = match talkkeeper_audio::list_input_devices()
        .map_err(err)?
        .into_iter()
        .next()
    {
        Some(device) => device,
        None => return Ok("no_device".into()),
    };
    let selected_device = device.clone();
    let capture = tokio::task::spawn_blocking(move || {
        talkkeeper_audio::Capture::start(talkkeeper_audio::CaptureConfig {
            mic_device: Some(selected_device),
            capture_system: false,
        })
    })
    .await
    .map_err(err)?;
    let mut capture = match capture {
        Ok(c) => c,
        Err(_) => return Ok("no_device".into()),
    };
    capture.resume();
    let deadline = tokio::time::sleep(std::time::Duration::from_secs(10));
    tokio::pin!(deadline);
    let silent_deadline = tokio::time::sleep(std::time::Duration::from_secs(5));
    tokio::pin!(silent_deadline);
    let mut sound = false;
    let mut words = false;
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            _ = &mut silent_deadline, if !sound => break,
            event = events.next() => {
                if let Some(Ok(event)) = event { if !event.text.trim().is_empty() { words = true; app.emit("setup://microphone", json!({"level":0,"text":event.text,"device":device})).map_err(err)?; } }
            }
            frame = capture.frames.recv() => {
                let Some(frame) = frame else { break; };
                let level = 10_f32.powf(talkkeeper_audio::rms_dbfs(&frame.samples)/20.);
                sound |= level > 0.005;
                app.emit("setup://microphone", json!({"level":level,"device":device})).map_err(err)?;
                stt.enqueue(talkkeeper_transcribe::AudioChunk { channel:talkkeeper_transcribe::Channel::Mic, sample_rate:frame.sample_rate, samples:frame.samples, start_ms:frame.timestamp_ms }).map_err(err)?;
            }
        }
    }
    capture.stop();
    stt.finish().await.map_err(err)?;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while let Some(event) = events.next().await {
            if let Ok(event) = event {
                words |= !event.text.trim().is_empty();
                app.emit(
                    "setup://microphone",
                    json!({"level":0,"text":event.text,"device":device}),
                )
                .map_err(err)?;
            }
        }
        Ok::<(), String>(())
    })
    .await;
    Ok(if !sound {
        "silent"
    } else if words {
        "success"
    } else {
        "no_words"
    }
    .into())
}

pub fn queue_recording(store: &Mutex<Store>, note_id: Uuid) -> Result<()> {
    let mut store = store.lock().map_err(err)?;
    if store
        .get_setting("setup.pending_plan")
        .map_err(err)?
        .is_none()
    {
        return Ok(());
    }
    if store.get_setting("setup.completed").map_err(err)? == Some(json!(true))
        || preferences(&store)?["provider"]
            .as_str()
            .is_some_and(|p| p != "Automatic")
    {
        return Ok(());
    }
    let mut queue: Vec<Uuid> = serde_json::from_value(
        store
            .get_setting("setup.ai_queue")
            .map_err(err)?
            .unwrap_or(json!([])),
    )
    .map_err(err)?;
    if !queue.contains(&note_id) {
        queue.push(note_id);
    }
    store
        .set_setting("setup.ai_queue", &json!(queue))
        .map_err(err)
}
pub async fn drain_queue(app: &tauri::AppHandle) -> Result<()> {
    let setup = app.state::<SetupState>();
    let _queue = setup.queue.lock().await;
    let state = app.state::<AppState>();
    if state.capture.lock().map_err(err)?.is_some() {
        return Ok(());
    }
    let queue: Vec<Uuid> = {
        let store = state.store.lock().map_err(err)?;
        if store.get_setting("setup.completed").map_err(err)? != Some(json!(true))
            && preferences(&store)?["provider"] == "Automatic"
        {
            return Ok(());
        }
        serde_json::from_value(
            store
                .get_setting("setup.ai_queue")
                .map_err(err)?
                .unwrap_or(json!([])),
        )
        .map_err(err)?
    };
    for id in queue {
        let available = state
            .store
            .lock()
            .map_err(err)?
            .get_note(id)
            .map_err(err)?
            .is_some_and(|n| n.deleted_at.is_none());
        if available {
            let _ = app.emit("setup://writing", json!({"note_id":id,"active":true}));
            let result = enhance_note(app.clone(), state.clone(), id, "auto".into()).await;
            let _ = app.emit("setup://writing", json!({"note_id":id,"active":false}));
            result?;
        }
        let mut store = state.store.lock().map_err(err)?;
        let mut remaining: Vec<Uuid> = serde_json::from_value(
            store
                .get_setting("setup.ai_queue")
                .map_err(err)?
                .unwrap_or(json!([])),
        )
        .map_err(err)?;
        remaining.retain(|n| *n != id);
        store
            .set_setting("setup.ai_queue", &json!(remaining))
            .map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn setup_preference(
    state: tauri::State<'_, AppState>,
    name: String,
    value: bool,
) -> Result<()> {
    if !["card_dismissed", "quit_confirmed", "ai_skipped"].contains(&name.as_str()) {
        return Err("Unknown setup preference".into());
    }
    state
        .store
        .lock()
        .map_err(err)?
        .set_setting(&format!("setup.{name}"), &json!(value))
        .map_err(err)
}

#[tauri::command]
pub async fn setup_remove_ai_download(
    state: tauri::State<'_, AppState>,
    setup: tauri::State<'_, SetupState>,
) -> Result<()> {
    if setup.cancel.lock().map_err(err)?.is_some() {
        return Err("Pause the download first".into());
    }
    // Only application-owned incomplete files are removed; installed engines and speech stay.
    let archive = state.directory.join("ollama/engine.download");
    match tokio::fs::remove_file(archive).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(err(e)),
    }
    let blobs = state.directory.join("ollama/models/blobs");
    if let Ok(mut entries) = tokio::fs::read_dir(blobs).await {
        while let Some(entry) = entries.next_entry().await.map_err(err)? {
            if entry.file_name().to_string_lossy().contains("-partial")
                && entry.file_type().await.map_err(err)?.is_file()
            {
                tokio::fs::remove_file(entry.path()).await.map_err(err)?;
            }
        }
    }
    Ok(())
}

fn should_resume(store: &Store) -> bool {
    store
        .get_setting("setup.pending_plan")
        .ok()
        .flatten()
        .is_some()
        && store.get_setting("setup.completed").ok().flatten() != Some(json!(true))
        && store.get_setting("setup.paused").ok().flatten() != Some(json!(true))
}
#[cfg(test)]
mod resume_tests {
    use super::*;
    #[test]
    fn unfinished_plan_resumes_after_reopening_but_explicit_pause_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("resume.sqlite");
        {
            let mut store = Store::open(&path).unwrap();
            store
                .set_setting("setup.pending_plan", &json!({"saved":true}))
                .unwrap();
            store
                .set_setting("setup.stage", &json!("PullModel"))
                .unwrap();
        }
        let mut store = Store::open(&path).unwrap();
        assert!(should_resume(&store));
        assert_eq!(
            store.get_setting("setup.stage").unwrap(),
            Some(json!("PullModel"))
        );
        store.set_setting("setup.paused", &json!(true)).unwrap();
        assert!(!should_resume(&store));
        store.set_setting("setup.paused", &json!(false)).unwrap();
        store.set_setting("setup.completed", &json!(true)).unwrap();
        assert!(!should_resume(&store));
    }
}
