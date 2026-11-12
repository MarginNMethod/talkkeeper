use super::*;
use talkkeeper_audio::{Capture, CaptureConfig, Source};
use talkkeeper_transcribe::{AudioChunk, Channel, Language, SttEngine, SttOptions, SttSession};

pub(super) async fn begin_transcription(
    engine: &dyn SttEngine,
    prefs: &Value,
) -> Result<SttSession> {
    let language = match prefs["language"].as_str().unwrap_or("auto") {
        "auto" => Language::Auto,
        code => Language::Code(code.into()),
    };
    let vocabulary = prefs["vocabulary"]
        .as_array()
        .map(|terms| {
            terms
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    engine
        .start(SttOptions {
            language,
            vocabulary,
        })
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn start_capture(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    note_id: Uuid,
) -> Result<()> {
    let prefs = {
        let store = state.store.lock().map_err(err)?;
        let note = store
            .get_note(note_id)
            .map_err(err)?
            .ok_or("Note not found")?;
        if note.deleted_at.is_some() {
            return Err("Restore this note before recording".into());
        }
        store
            .get_setting("preferences")
            .map_err(err)?
            .unwrap_or(json!({}))
    };
    let (tx, rx) = tokio::sync::mpsc::channel(8);
    {
        let mut active = state.capture.lock().map_err(err)?;
        if active.is_some() {
            return Err("Capture already active".into());
        }
        if app.state::<dictation::VoiceState>().is_active() {
            return Err("Stop dictation before starting meeting capture".into());
        }
        *active = Some(tx);
    }
    let result = prepare_capture(app, &state, note_id, prefs, rx).await;
    if result.is_err() {
        *state.capture.lock().map_err(err)? = None;
    }
    result
}

async fn prepare_capture(
    app: tauri::AppHandle,
    state: &AppState,
    note_id: Uuid,
    prefs: Value,
    rx: tokio::sync::mpsc::Receiver<String>,
) -> Result<()> {
    let engine = speech_engine(state, &prefs).await?;
    let mut stt = begin_transcription(engine.as_ref(), &prefs).await?;
    let events = stt.events().ok_or("STT events unavailable")?;
    let capture = tokio::task::spawn_blocking(|| {
        Capture::start(CaptureConfig {
            mic_device: None,
            capture_system: talkkeeper_audio::SYSTEM_AUDIO_AVAILABLE,
        })
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    {
        let mut db = state.store.lock().map_err(err)?;
        let mut note = db.get_note(note_id).map_err(err)?.ok_or("Note not found")?;
        note.started_at.get_or_insert(chrono::Utc::now());
        note.ended_at = None;
        db.update_note(&note).map_err(err)?;
    }
    app.emit(
        "capture://state",
        json!({"note_id": note_id, "state": "recording"}),
    )
    .map_err(err)?;
    let app = app.clone();
    let store = state.store.clone();
    // SttSession is Send, but not Sync. Keep its input future on one runtime thread.
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("capture runtime");
        runtime.block_on(run_capture(app, store, note_id, capture, stt, events, rx));
    });
    Ok(())
}

async fn persist_events(
    app: tauri::AppHandle,
    store: Arc<Mutex<Store>>,
    note_id: Uuid,
    mut events: talkkeeper_transcribe::EventStream,
) -> Result<()> {
    let mut seq = store
        .lock()
        .map_err(err)?
        .list_transcript_segments(note_id)
        .map_err(err)?
        .last()
        .map(|s| s.seq + 1)
        .unwrap_or(1);
    while let Some(event) = events.next().await {
        let event = event.map_err(err)?;
        if !event.is_final {
            continue;
        }
        let segment = talkkeeper_core::TranscriptSegment {
            id: Uuid::new_v4(),
            note_id,
            seq,
            start_ms: event.start_ms,
            end_ms: event.end_ms,
            speaker: if event.channel == Channel::Mic {
                talkkeeper_core::Speaker::Me
            } else {
                talkkeeper_core::Speaker::Them
            },
            text: event.text,
            lang: event.lang,
            created_at: chrono::Utc::now(),
        };
        store
            .lock()
            .map_err(err)?
            .append_transcript_segments(std::slice::from_ref(&segment))
            .map_err(err)?;
        app.emit("transcript://segment", &segment).map_err(err)?;
        seq += 1;
    }
    Ok(())
}

async fn run_capture(
    app: tauri::AppHandle,
    store: Arc<Mutex<Store>>,
    note_id: Uuid,
    mut capture: talkkeeper_audio::CaptureHandle,
    stt: SttSession,
    events: talkkeeper_transcribe::EventStream,
    mut rx: tokio::sync::mpsc::Receiver<String>,
) {
    let output =
        tauri::async_runtime::spawn(persist_events(app.clone(), store.clone(), note_id, events));
    let mut monitor = talkkeeper_transcribe::vad::SilenceMonitor::new(5, 0);
    let clock = std::time::Instant::now();
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    let mut paused = false;
    let result: Result<()> = async {
        loop {
            tokio::select! {
                command = rx.recv() => {
                    let status = match command.as_deref() {
                        Some("pause") => { capture.pause(); paused = true; "paused" },
                        Some("resume") => { capture.resume(); paused = false; monitor = talkkeeper_transcribe::vad::SilenceMonitor::new(5, clock.elapsed().as_millis() as u64); "recording" },
                        _ => break,
                    };
                    app.emit("capture://state", json!({"note_id": note_id, "state": status})).map_err(err)?;
                }
                error = capture.errors.recv() => {
                    match error { Some(e) => return Err(err(e)), None => break }
                }
                frame = capture.frames.recv() => {
                    let Some(frame) = frame else { break };
                    if paused { continue; }
                    let level = talkkeeper_audio::rms_dbfs(&frame.samples);
                    app.emit("capture://level", json!({"note_id": note_id, "source": if frame.source == Source::Mic { "Me" } else { "Them" }, "level": if level.is_finite() { level } else { -100.0 }})).map_err(err)?;
                    if monitor.observe(clock.elapsed().as_millis() as u64, level > -40.0).is_some() {
                        app.emit("capture://auto-stop-suggested", json!({"note_id": note_id})).map_err(err)?;
                    }
                    stt.push(AudioChunk {
                        channel: if frame.source == Source::Mic { Channel::Mic } else { Channel::System },
                        sample_rate: 16000,
                        samples: talkkeeper_transcribe::resample(&frame.samples, frame.sample_rate).map_err(err)?,
                        start_ms: frame.timestamp_ms,
                    }).await.map_err(err)?;
                }
                _ = tick.tick() => {
                    if !paused && monitor.observe(clock.elapsed().as_millis() as u64, false).is_some() {
                        app.emit("capture://auto-stop-suggested", json!({"note_id": note_id})).map_err(err)?;
                    }
                }
            }
        }
        Ok(())
    }.await;
    capture.stop();
    let finish = stt.finish().await.map_err(err);
    let drain = output.await.map_err(err).and_then(|r| r);
    let result = result.and(finish).and(drain);
    let state = app.state::<AppState>();
    if let Ok(mut db) = store.lock() {
        if let Ok(Some(mut note)) = db.get_note(note_id) {
            note.ended_at = Some(chrono::Utc::now());
            let _ = db.update_note(&note);
        }
    }
    if let Ok(mut active) = state.capture.lock() {
        *active = None;
    }
    let _ = app.emit(
        "capture://state",
        json!({"note_id": note_id, "state": "stopped", "error": result.err()}),
    );
}

fn control(state: tauri::State<'_, AppState>, command: &str) -> Result<()> {
    state
        .capture
        .lock()
        .map_err(err)?
        .as_ref()
        .ok_or("No active capture")?
        .try_send(command.into())
        .map_err(err)
}
#[tauri::command]
pub fn pause_capture(state: tauri::State<'_, AppState>) -> Result<()> {
    control(state, "pause")
}
#[tauri::command]
pub fn resume_capture(state: tauri::State<'_, AppState>) -> Result<()> {
    control(state, "resume")
}
#[tauri::command]
pub fn stop_capture(state: tauri::State<'_, AppState>) -> Result<()> {
    control(state, "stop")
}

pub(super) async fn speech_engine(state: &AppState, prefs: &Value) -> Result<Box<dyn SttEngine>> {
    let model = prefs["stt_model"]
        .as_str()
        .ok_or("Choose an STT model in Settings")?;
    let engine: Box<dyn SttEngine> = if prefs["stt_engine"].as_str().unwrap_or("local") == "local" {
        let model = talkkeeper_transcribe::models::MODELS
            .iter()
            .find(|m| m.name == model)
            .ok_or("Unknown local model")?;
        let manager = talkkeeper_transcribe::models::ModelManager::new(&state.directory);
        if !manager.is_present(model).await.map_err(err)? {
            return Err("Download the selected model first".into());
        }
        Box::new(
            talkkeeper_transcribe::local::LocalEngine::load(manager.path(model))
                .await
                .map_err(err)?,
        )
    } else {
        Box::new(talkkeeper_transcribe::cloud::OpenAiCompatible::new(
            prefs["stt_url"]
                .as_str()
                .ok_or("Set the transcription endpoint")?
                .into(),
            KeyringSecretStore
                .get("stt")
                .map_err(err)?
                .ok_or("Set the transcription key")?,
            model.into(),
        ))
    };
    Ok(engine)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct UnavailableEngine;
    #[async_trait::async_trait]
    impl SttEngine for UnavailableEngine {
        async fn start(&self, options: SttOptions) -> talkkeeper_transcribe::Result<SttSession> {
            assert!(matches!(options.language, Language::Code(code) if code == "fr"));
            assert_eq!(options.vocabulary, ["herbs"]);
            Err(talkkeeper_transcribe::Error::Provider(
                "Test engine unavailable".into(),
            ))
        }
    }
    #[tokio::test]
    async fn session_start_passes_options_and_reports_engine_errors() {
        let result = begin_transcription(
            &UnavailableEngine,
            &json!({"language":"fr","vocabulary":["herbs"]}),
        )
        .await;
        assert!(matches!(result, Err(e) if e.contains("Test engine unavailable")));
    }
}
