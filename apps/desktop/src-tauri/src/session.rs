use super::*;
use talkkeeper_audio::{Capture, CaptureConfig, Source};
use talkkeeper_transcribe::{AudioChunk, Channel, Language, SttEngine, SttOptions, SttSession};

pub(super) static DOWNLOAD_CANCEL: tokio::sync::Notify = tokio::sync::Notify::const_new();
#[tauri::command]
pub fn cancel_model_download() {
    DOWNLOAD_CANCEL.notify_waiters();
}

pub struct ActiveCapture {
    sender: tokio::sync::mpsc::Sender<String>,
    note_id: Uuid,
    state: &'static str,
    elapsed: std::time::Duration,
    since: std::time::Instant,
}
impl ActiveCapture {
    fn elapsed_ms(&self) -> u64 {
        (self.elapsed
            + if self.state == "recording" {
                self.since.elapsed()
            } else {
                std::time::Duration::ZERO
            })
        .as_millis() as u64
    }
    fn transition(&mut self, state: &'static str) {
        self.elapsed = std::time::Duration::from_millis(self.elapsed_ms());
        self.since = std::time::Instant::now();
        self.state = state;
    }
    fn control(&self, note_id: Uuid, command: &str) -> Result<()> {
        if self.note_id != note_id {
            return Err("Recording belongs to another note".into());
        }
        self.sender.try_send(command.into()).map_err(err)
    }
}
fn status_value(active: Option<&ActiveCapture>) -> Value {
    match active {
        Some(active) => {
            json!({"note_id":active.note_id,"state":active.state,"elapsed_ms":active.elapsed_ms()})
        }
        None => json!({"note_id":null,"state":"stopped","elapsed_ms":0}),
    }
}
#[tauri::command]
pub fn capture_status(state: tauri::State<'_, AppState>) -> Result<Value> {
    Ok(status_value(state.capture.lock().map_err(err)?.as_ref()))
}
fn transition(app: &tauri::AppHandle, status: &'static str) -> Result<()> {
    let state = app.state::<AppState>();
    let mut active = state.capture.lock().map_err(err)?;
    if let Some(active) = active.as_mut() {
        active.transition(status);
    }
    app.emit("capture://state", status_value(active.as_ref()))
        .map_err(err)
}

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
        *active = Some(ActiveCapture {
            sender: tx,
            note_id,
            state: "starting",
            elapsed: std::time::Duration::ZERO,
            since: std::time::Instant::now(),
        });
    }
    let result = prepare_capture(app, &state, note_id, prefs, rx)
        .await
        .map_err(|error| format!("Could not start recording: {error}"));
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
    mut rx: tokio::sync::mpsc::Receiver<String>,
) -> Result<()> {
    tokio::task::spawn_blocking(talkkeeper_audio::authorize_microphone)
        .await
        .map_err(err)?
        .map_err(err)?;
    let engine = speech_engine(state, &prefs).await?;
    let mut stt = begin_transcription(engine.as_ref(), &prefs).await?;
    let events = stt.events().ok_or("STT events unavailable")?;
    if rx.try_recv().is_ok() {
        return Err("Recording cancelled".into());
    }
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
    state
        .snapshots
        .lock()
        .map_err(err)?
        .recording(note_id, true);
    transition(&app, "recording")?;
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
    events: talkkeeper_transcribe::EventStream,
) -> Result<()> {
    persist_segments(store, note_id, events, |segment| {
        app.emit("transcript://segment", segment).map_err(err)
    })
    .await
}

async fn persist_segments(
    store: Arc<Mutex<Store>>,
    note_id: Uuid,
    mut events: talkkeeper_transcribe::EventStream,
    emit: impl Fn(&talkkeeper_core::TranscriptSegment) -> Result<()>,
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
        emit(&segment)?;
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
    let mut output =
        tauri::async_runtime::spawn(persist_events(app.clone(), store.clone(), note_id, events));
    let mut monitor = talkkeeper_transcribe::vad::SilenceMonitor::new(5, 0);
    let clock = std::time::Instant::now();
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    let mut paused = false;
    let mut pipeline = FramePipeline::default();
    let mut output_result = None;
    let mut overflow_warned = false;
    let result: Result<()> = async {
        loop {
            tokio::select! {
                completed = &mut output => {
                    output_result = Some(completed.map_err(err).and_then(|r| r).and(Err("Speech recognition stopped unexpectedly. Please try recording again.".into())));
                    break;
                }
                command = rx.recv() => {
                    let status = match command.as_deref() {
                        Some("pause") => { capture.pause(); paused = true; "paused" },
                        Some("resume") => { capture.resume(); paused = false; monitor = talkkeeper_transcribe::vad::SilenceMonitor::new(5, clock.elapsed().as_millis() as u64); "recording" },
                        _ => break,
                    };
                    app.state::<AppState>().snapshots.lock().map_err(err)?.recording(note_id, !paused);
                    transition(&app, status)?;
                }
                error = capture.errors.recv() => {
                    match error { Some(e) => return Err(format!("Recording failed: {e}. Please check your audio devices and try again.")), None => return Err("The audio device stopped. Check your microphone and try again.".into()) }
                }
                frame = capture.frames.recv() => {
                    let Some(frame) = frame else { return Err("The microphone stopped sending audio. Check your audio devices and try again.".into()) };
                    if paused { continue; }
                    let level = talkkeeper_audio::rms_dbfs(&frame.samples);
                    if monitor.observe(clock.elapsed().as_millis() as u64, level > -40.0).is_some() {
                        app.emit("capture://auto-stop-suggested", json!({"note_id": note_id})).map_err(err)?;
                        notify_recording(&app, note_id, true);
                    }
                    let warning = pipeline.push(&stt, frame, clock.elapsed().as_millis() as u64, |source, level| {
                        app.emit("capture://level", json!({"note_id":note_id,"source":source,"level":level})).map_err(err)
                    })?;
                    if let Some(active) = warning {
                        app.emit("capture://warning", json!({"note_id": note_id, "kind":"mic_silent", "active":active})).map_err(err)?;
                    }
                    if stt.take_overflow() && !overflow_warned {
                        overflow_warned = true;
                        app.emit("capture://warning", json!({"note_id":note_id,"kind":"audio_dropped","active":true})).map_err(err)?;
                    }
                }
                _ = tick.tick() => {
                    app.emit("capture://lag", json!({"note_id":note_id,"seconds":stt.pending_seconds()})).map_err(err)?;
                    let snapshot_app = app.clone();
                    tauri::async_runtime::spawn_blocking(move || snapshots::tick(&snapshot_app));
                    if !paused && monitor.observe(clock.elapsed().as_millis() as u64, false).is_some() {
                        app.emit("capture://auto-stop-suggested", json!({"note_id": note_id})).map_err(err)?;
                        notify_recording(&app, note_id, true);
                    }
                }
            }
        }
        Ok(())
    }.await;
    if let Ok(mut session) = app.state::<AppState>().snapshots.lock() {
        session.stop();
    }
    let _ = transition(&app, "finishing");
    capture.stop();
    let finish = stt.finish().await.map_err(err);
    let drain = match output_result {
        Some(result) => result,
        None => output.await.map_err(err).and_then(|r| r),
    };
    // The decoder error explains a closed input queue; preserve it first.
    let result = drain.and(result).and(finish);
    if result.is_err() {
        notify_recording(&app, note_id, false);
    }
    let state = app.state::<AppState>();
    let elapsed_ms = state
        .capture
        .lock()
        .ok()
        .and_then(|active| active.as_ref().map(ActiveCapture::elapsed_ms))
        .unwrap_or(0);
    if let Ok(mut db) = store.lock() {
        if let Ok(Some(mut note)) = db.get_note(note_id) {
            note.ended_at = Some(chrono::Utc::now());
            let _ = db.update_note(&note);
            let key = format!("recorded_duration.{note_id}");
            let previous = db
                .get_setting(&key)
                .ok()
                .flatten()
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let _ = db.set_setting(&key, &json!(previous + elapsed_ms));
        }
    }
    if let Ok(mut active) = state.capture.lock() {
        *active = None;
    }
    let _ = app.emit(
        "capture://state",
        json!({"note_id": note_id, "state": "stopped", "elapsed_ms":elapsed_ms, "error": result.err()}),
    );
}

fn control(state: tauri::State<'_, AppState>, note_id: Uuid, command: &str) -> Result<()> {
    state
        .capture
        .lock()
        .map_err(err)?
        .as_ref()
        .ok_or("No active capture")?
        .control(note_id, command)
}
#[tauri::command]
pub fn pause_capture(state: tauri::State<'_, AppState>, note_id: Uuid) -> Result<()> {
    control(state, note_id, "pause")
}
#[tauri::command]
pub fn resume_capture(state: tauri::State<'_, AppState>, note_id: Uuid) -> Result<()> {
    control(state, note_id, "resume")
}
#[tauri::command]
pub fn stop_capture(state: tauri::State<'_, AppState>, note_id: Uuid) -> Result<()> {
    control(state, note_id, "stop")
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

#[derive(Default)]
struct FramePipeline {
    mic: talkkeeper_transcribe::StreamingResampler,
    system: talkkeeper_transcribe::StreamingResampler,
    mic_sound: bool,
    last_sound_ms: u64,
    silent_warning: bool,
    mic_next_ms: Option<u64>,
    system_next_ms: Option<u64>,
}
impl FramePipeline {
    fn push(
        &mut self,
        stt: &SttSession,
        frame: talkkeeper_audio::AudioFrame,
        elapsed_ms: u64,
        emit_level: impl FnOnce(&str, f32) -> Result<()>,
    ) -> Result<Option<bool>> {
        let level = talkkeeper_audio::rms_dbfs(&frame.samples);
        emit_level(
            if frame.source == Source::Mic {
                "Me"
            } else {
                "Them"
            },
            if level.is_finite() { level } else { -100. },
        )?;
        let mut warning = None;
        if frame.source == Source::Mic {
            if level > -60.0 {
                self.mic_sound = true;
                self.last_sound_ms = elapsed_ms;
            }
            if level > -40.0 && self.silent_warning {
                self.silent_warning = false;
                warning = Some(false);
            } else if level <= -60.0
                && !self.silent_warning
                && elapsed_ms.saturating_sub(self.last_sound_ms)
                    >= if self.mic_sound { 20000 } else { 8000 }
            {
                self.silent_warning = true;
                warning = Some(true);
            }
        }
        let (resampler, next, channel) = if frame.source == Source::Mic {
            (&mut self.mic, &mut self.mic_next_ms, Channel::Mic)
        } else {
            (&mut self.system, &mut self.system_next_ms, Channel::System)
        };
        // Preserve the sample clock across callback jitter, but retain real gaps
        // (pause/resume or dropped capture frames) in transcript timestamps.
        let start = match *next {
            Some(ms) if ms.abs_diff(frame.timestamp_ms) < 100 => ms,
            _ => frame.timestamp_ms,
        };
        let samples = resampler
            .push(&frame.samples, frame.sample_rate)
            .map_err(err)?;
        *next = Some(start + samples.len() as u64 / 16);
        if !samples.is_empty() {
            stt.enqueue(AudioChunk {
                channel,
                sample_rate: 16000,
                samples,
                start_ms: start,
            })
            .map_err(err)?;
        }
        Ok(warning)
    }
}

#[tauri::command]
pub fn capture_capabilities() -> Value {
    let permissions = talkkeeper_audio::permissions_status();
    json!({"system_audio":talkkeeper_audio::SYSTEM_AUDIO_AVAILABLE,"microphone":permissions.microphone,"system":permissions.system})
}
#[tauri::command]
pub fn open_microphone_settings() -> Result<()> {
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        .status()
        .map_err(err)?;
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:privacy-microphone"])
        .status()
        .map_err(err)?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return if status.success() {
        Ok(())
    } else {
        Err(
            "Could not open microphone settings. Open your system privacy settings manually."
                .into(),
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("Open your system sound settings and check microphone access in your audio server or sandbox settings.".into())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn stop_from_notification(app: &tauri::AppHandle, note_id: Uuid) {
    let state = app.state::<AppState>();
    if let Ok(active) = state.capture.lock() {
        if let Some(active) = active.as_ref() {
            let _ = active.control(note_id, "stop");
        }
    };
}

// Notifications use the platform's own tools and sound; no audio is sent out.
fn notify_recording(app: &tauri::AppHandle, note_id: Uuid, quiet: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        #[cfg(target_os = "linux")]
        {
            if quiet {
                if let Ok(output) = std::process::Command::new("notify-send")
                    .args([
                        "--app-name=TalkKeeper",
                        "--action=stop=Stop recording",
                        "--action=keep=Keep recording",
                        "--wait",
                        "It's been quiet for 5 minutes",
                        "Has the meeting ended?",
                    ])
                    .output()
                {
                    if String::from_utf8_lossy(&output.stdout).trim() == "stop" {
                        let state = app.state::<AppState>();
                        if let Ok(active) = state.capture.lock() {
                            if let Some(active) = active.as_ref() {
                                let _ = active.control(note_id, "stop");
                            }
                        };
                    }
                }
            } else {
                let _ = std::process::Command::new("notify-send")
                    .args([
                        "--app-name=TalkKeeper",
                        "TalkKeeper stopped recording",
                        "Everything up to this point is saved in the transcript.",
                    ])
                    .status();
                let _ = std::process::Command::new("canberra-gtk-play")
                    .args(["--id=dialog-warning"])
                    .status();
            }
        }
        #[cfg(target_os = "macos")]
        {
            let script = if quiet {
                "display notification \"Has the meeting ended?\" with title \"It's been quiet for 5 minutes\" sound name \"Glass\"\ndisplay dialog \"Has the meeting ended?\" with title \"It's been quiet for 5 minutes\" buttons {\"Keep recording\", \"Stop recording\"} default button \"Keep recording\""
            } else {
                "display notification \"Everything up to this point is saved in the transcript.\" with title \"TalkKeeper stopped recording\" sound name \"Glass\""
            };
            if let Ok(output) = std::process::Command::new("osascript")
                .args(["-e", script])
                .output()
            {
                if quiet
                    && String::from_utf8_lossy(&output.stdout)
                        .contains("button returned:Stop recording")
                {
                    stop_from_notification(&app, note_id);
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            let title = if quiet {
                "It's been quiet for 5 minutes"
            } else {
                "TalkKeeper stopped recording"
            };
            let script = format!("Add-Type -AssemblyName System.Windows.Forms; [System.Media.SystemSounds]::Exclamation.Play(); $notice = New-Object System.Windows.Forms.NotifyIcon; $notice.Icon = [System.Drawing.SystemIcons]::Information; $notice.Visible = $true; $notice.ShowBalloonTip(10000, \"{title}\", 'Open TalkKeeper to review the recording.', [System.Windows.Forms.ToolTipIcon]::Warning); Start-Sleep -Seconds 10; $notice.Dispose()");
            let script = if quiet {
                format!(
                    r#"{script}; $form = New-Object System.Windows.Forms.Form; $form.Text = "It's been quiet for 5 minutes"; $form.Width=390; $form.Height=160; $stop = New-Object System.Windows.Forms.Button; $stop.Text='Stop recording'; $stop.Width=150; $stop.Top=40; $stop.Left=10; $stop.DialogResult=[System.Windows.Forms.DialogResult]::Yes; $keep = New-Object System.Windows.Forms.Button; $keep.Text='Keep recording'; $keep.Width=150; $keep.Top=40; $keep.Left=180; $keep.DialogResult=[System.Windows.Forms.DialogResult]::No; $form.Controls.AddRange(@($stop,$keep)); if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::Yes) {{ Write-Output 'stop' }}; $form.Dispose()"#
                )
            } else {
                script
            };
            if let Ok(output) = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .output()
            {
                if quiet && String::from_utf8_lossy(&output.stdout).trim() == "stop" {
                    stop_from_notification(&app, note_id);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_and_controls_are_scoped_to_note() {
        let (sender, mut rx) = tokio::sync::mpsc::channel(8);
        let id = Uuid::new_v4();
        let mut active = ActiveCapture {
            sender,
            note_id: id,
            state: "recording",
            elapsed: std::time::Duration::from_secs(2),
            since: std::time::Instant::now(),
        };
        assert_eq!(status_value(None)["state"], "stopped");
        assert_eq!(status_value(Some(&active))["note_id"], id.to_string());
        for command in ["pause", "stop"] {
            assert!(active.control(Uuid::new_v4(), command).is_err());
        }
        assert!(rx.try_recv().is_err());
        active.control(id, "pause").unwrap();
        assert_eq!(rx.try_recv().unwrap(), "pause");
        active.transition("paused");
        let elapsed = active.elapsed_ms();
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert_eq!(active.elapsed_ms(), elapsed);
        assert!(elapsed >= 2000);
    }
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
    struct SlowDecoder;
    #[async_trait::async_trait]
    impl talkkeeper_transcribe::SegmentDecoder for SlowDecoder {
        async fn decode(
            &self,
            audio: AudioChunk,
            _: &SttOptions,
        ) -> talkkeeper_transcribe::Result<Vec<talkkeeper_transcribe::TranscriptEvent>> {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            Ok(vec![talkkeeper_transcribe::TranscriptEvent {
                channel: audio.channel,
                start_ms: audio.start_ms,
                end_ms: audio.start_ms + audio.samples.len() as u64 / 16,
                text: "Test sentence".into(),
                lang: None,
                is_final: true,
            }])
        }
    }
    fn frame(index: u64, sound: bool) -> talkkeeper_audio::AudioFrame {
        talkkeeper_audio::AudioFrame {
            source: Source::Mic,
            sample_rate: 48000,
            channels: 1,
            timestamp_ms: index * 10,
            samples: (0..480)
                .map(|i| {
                    if sound {
                        (i as f32 * std::f32::consts::TAU * 440. / 48000.).sin() * 0.2
                    } else {
                        0.
                    }
                })
                .collect(),
        }
    }
    #[tokio::test]
    async fn slow_speech_keeps_capture_and_levels_flowing_then_persists() {
        let store = Arc::new(Mutex::new(Store::open_in_memory().unwrap()));
        let note = Note::new("Recording");
        store.lock().unwrap().create_note(&note).unwrap();
        let mut stt = talkkeeper_transcribe::segmented_session(SlowDecoder, SttOptions::default());
        let events = stt.events().unwrap();
        let db = store.clone();
        let id = note.id;
        let persisted = tokio::spawn(persist_segments(db, id, events, |_| Ok(())));
        // Same small ingress queue as a real device; try_send catches stalls.
        let (tx, mut rx) = tokio::sync::mpsc::channel(128);
        let source = tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_millis(10));
            for i in 0..340 {
                tick.tick().await;
                tx.try_send(frame(i, i % 100 < 30))
                    .expect("capture must not overflow");
            }
        });
        let mut pipeline = FramePipeline::default();
        let levels = std::sync::atomic::AtomicUsize::new(0);
        let clock = std::time::Instant::now();
        while let Some(frame) = rx.recv().await {
            pipeline
                .push(&stt, frame, clock.elapsed().as_millis() as u64, |_, _| {
                    levels.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    Ok(())
                })
                .unwrap();
        }
        source.await.unwrap();
        assert_eq!(levels.load(std::sync::atomic::Ordering::Relaxed), 340);
        assert!(clock.elapsed() < std::time::Duration::from_secs(5));
        stt.finish().await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(12), persisted)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let segments = store.lock().unwrap().list_transcript_segments(id).unwrap();
        assert!(segments.len() >= 3);
        assert!(segments.iter().all(|s| s.text == "Test sentence"));
    }
    #[tokio::test]
    async fn silent_mic_warns_once_then_clears_on_sound() {
        let stt = talkkeeper_transcribe::segmented_session(SlowDecoder, SttOptions::default());
        let mut pipeline = FramePipeline::default();
        for (ms, sound, expected) in [
            (7990, false, None),
            (8000, false, Some(true)),
            (9000, false, None),
            (9010, true, Some(false)),
            (10000, false, None),
            (30010, false, Some(true)),
        ] {
            assert_eq!(
                pipeline
                    .push(&stt, frame(ms / 10, sound), ms, |_, _| Ok(()))
                    .unwrap(),
                expected
            );
        }
    }
}
