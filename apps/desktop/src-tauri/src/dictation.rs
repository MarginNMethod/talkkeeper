use super::voice_flow::{Flow, Phase};
use super::*;
use talkkeeper_audio::{Capture, CaptureConfig};
use talkkeeper_transcribe::{AudioChunk, Channel};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";
#[derive(Default)]
pub struct VoiceState {
    escape_registered: std::sync::atomic::AtomicBool,
    cancelled: std::sync::atomic::AtomicBool,
    notice: Mutex<Option<String>>,
    ready: std::sync::atomic::AtomicBool,
    key_down: std::sync::atomic::AtomicBool,
    active: Mutex<Option<tokio::sync::mpsc::Sender<bool>>>,
    shortcut: Mutex<Option<Shortcut>>,
}
impl VoiceState {
    pub fn is_active(&self) -> bool {
        self.active.lock().map(|a| a.is_some()).unwrap_or(true)
    }
}
fn settings(s: &AppState) -> Result<Value> {
    Ok(s.store.lock().map_err(err)?.get_setting("dictation").map_err(err)?.unwrap_or(json!({"hotkey":DEFAULT_HOTKEY,"mode":"toggle","style":"As spoken","days":7,"cues":true,"replacements":[],"prompts":{}})))
}
pub fn validate(v: &Value) -> Result<Shortcut> {
    if !v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "hotkey",
                "mode",
                "style",
                "days",
                "cues",
                "replacements",
                "prompts",
            ]
            .contains(&k.as_str())
        })
    }) {
        return Err("Invalid dictation setting".into());
    }
    let key = v["hotkey"].as_str().ok_or("Choose a hotkey")?;
    let shortcut: Shortcut = key.parse().map_err(err)?;
    if ["Control+V", "Super+V"]
        .iter()
        .any(|s| s.parse::<Shortcut>().ok().as_ref() == Some(&shortcut))
    {
        return Err("Choose a shortcut other than the paste shortcut".into());
    }
    if !key.contains('+') || key.len() > 100 {
        return Err("Use a modifier and a key".into());
    }
    if !["toggle", "hold"].contains(&v["mode"].as_str().unwrap_or(""))
        || !["As spoken", "Clean", "Formal", "Bullet points"]
            .contains(&v["style"].as_str().unwrap_or(""))
        || !v["days"].as_u64().is_some_and(|n| n <= 36500)
        || !v["cues"].is_boolean()
    {
        return Err("Invalid dictation settings".into());
    }
    let rules: Vec<talkkeeper_core::Replacement> =
        serde_json::from_value(v["replacements"].clone()).map_err(err)?;
    if rules.len() > 100
        || rules
            .iter()
            .any(|r| r.from.trim().is_empty() || r.from.len() > 500 || r.to.len() > 500)
    {
        return Err("Use up to 100 nonempty replacement rules".into());
    }
    if !v["prompts"].as_object().is_some_and(|p| {
        p.values()
            .all(|s| s.as_str().is_some_and(|s| s.len() <= 4000))
    }) {
        return Err("Invalid style prompts".into());
    }
    Ok(shortcut)
}
pub fn register(app: &tauri::AppHandle, key: Shortcut) -> Result<()> {
    let voice = app.state::<VoiceState>();
    let mut current = voice.shortcut.lock().map_err(err)?;
    if current.as_ref() == Some(&key) {
        return Ok(());
    }
    app.global_shortcut().register(key).map_err(err)?;
    if let Some(old) = current.replace(key) {
        let _ = app.global_shortcut().unregister(old);
    }
    Ok(())
}
pub fn initialize(app: &tauri::AppHandle) {
    let result = settings(&app.state::<AppState>())
        .and_then(|v| {
            app.state::<AppState>()
                .store
                .lock()
                .map_err(err)?
                .retain_dictation(v["days"].as_u64().unwrap_or(7) as u32)
                .map_err(err)?;
            validate(&v)
        })
        .and_then(|key| register(app, key));
    if let Err(error) = result {
        if let Ok(mut notice) = app.state::<VoiceState>().notice.lock() {
            *notice=Some(format!("Dictation hotkey unavailable: {error}. Choose another shortcut in Settings. On Wayland, global shortcuts may not be supported."));
        }
        let _ = app.emit("dictation://state", json!({"state":"error","notice":error}));
    }
}
pub fn shortcut(
    app: &tauri::AppHandle,
    key: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    let pressed = event.state;
    let voice = app.state::<VoiceState>();
    if key.key == tauri_plugin_global_shortcut::Code::Escape {
        if pressed == ShortcutState::Pressed && voice.is_active() {
            voice
                .cancelled
                .store(true, std::sync::atomic::Ordering::Release);
            if let Ok(active) = voice.active.lock() {
                if let Some(tx) = active.as_ref() {
                    let _ = tx.try_send(true);
                }
            }
        }
        return;
    }
    if voice.shortcut.lock().ok().and_then(|k| *k).as_ref() != Some(key) {
        return;
    }
    let down = pressed == ShortcutState::Pressed;
    let was_down = voice
        .key_down
        .swap(down, std::sync::atomic::Ordering::AcqRel);
    if down && was_down {
        return;
    }
    let hold = settings(&app.state::<AppState>())
        .map(|v| v["mode"] == "hold")
        .unwrap_or(false);
    if pressed == ShortcutState::Released && !hold {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = control(
            app.clone(),
            if pressed == ShortcutState::Released {
                "stop"
            } else if hold {
                "hold_start"
            } else {
                "toggle"
            }
            .into(),
            false,
        )
        .await
        {
            let _ = app.emit("dictation://state", json!({"state":"error","notice":error}));
        }
    });
}
#[tauri::command]
pub fn dictation_data(app: tauri::AppHandle, action: String, payload: Value) -> Result<Value> {
    let state = app.state::<AppState>();
    match action.as_str() {
        "notice" => Ok(json!(*app
            .state::<VoiceState>()
            .notice
            .lock()
            .map_err(err)?)),
        "ready" => {
            app.state::<VoiceState>()
                .ready
                .store(true, std::sync::atomic::Ordering::Release);
            Ok(Value::Null)
        }
        "settings" => settings(&state),
        "save" => {
            let key = validate(&payload)?;
            register(&app, key)?;
            let mut db = state.store.lock().map_err(err)?;
            db.retain_dictation(payload["days"].as_u64().unwrap_or(7) as u32)
                .map_err(err)?;
            db.set_setting("dictation", &payload).map_err(err)?;
            Ok(Value::Null)
        }
        "history" => {
            let days = settings(&state)?["days"].as_u64().unwrap_or(7) as u32;
            let mut db = state.store.lock().map_err(err)?;
            db.retain_dictation(days).map_err(err)?;
            Ok(json!(db
                .dictation_history(payload["search"].as_str().unwrap_or(""))
                .map_err(err)?))
        }
        "delete" => {
            state
                .store
                .lock()
                .map_err(err)?
                .delete_dictation(serde_json::from_value(payload["id"].clone()).map_err(err)?)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "clear" => {
            state
                .store
                .lock()
                .map_err(err)?
                .retain_dictation(0)
                .map_err(err)?;
            Ok(Value::Null)
        }
        "permissions" => Ok(
            json!({"microphone":talkkeeper_audio::permissions_status().microphone,"paste":paste_guidance(),"devices":talkkeeper_audio::list_input_devices().map_err(err)?}),
        ),
        _ => Err("Unknown dictation action".into()),
    }
}
fn paste_guidance() -> &'static str {
    if cfg!(target_os = "macos") {
        "Allow TalkKeeper in System Settings > Privacy & Security > Accessibility, then restart. Microphone access is required too."
    } else if cfg!(target_os = "windows") {
        "Allow microphone access for desktop apps. Paste into an app running with the same privileges as TalkKeeper."
    } else {
        "Automatic paste requires X11. On Wayland, use Ctrl+V to paste the text left on your clipboard. Allow microphone access in your audio server."
    }
}
#[tauri::command]
pub async fn dictation_control(
    app: tauri::AppHandle,
    action: String,
    confirmed: bool,
) -> Result<()> {
    control(app, action, confirmed).await
}
async fn control(app: tauri::AppHandle, action: String, confirmed: bool) -> Result<()> {
    let voice = app.state::<VoiceState>();
    {
        let active = voice.active.lock().map_err(err)?;
        if let Some(tx) = active.as_ref() {
            if action == "cancel" {
                voice
                    .cancelled
                    .store(true, std::sync::atomic::Ordering::Release);
            }
            return tx.try_send(action == "cancel").map_err(err);
        }
    }
    if action == "cancel" || action == "stop" {
        return Ok(());
    }
    let state = app.state::<AppState>();
    // Lock both reservations in the same order as meeting startup.
    let mut config = settings(&state)?;
    config["require_hold"] = json!(action == "hold_start");
    let prefs = preferences(&*state.store.lock().map_err(err)?)?;
    let meeting = state.capture.lock().map_err(err)?;
    if meeting.is_some() && !confirmed {
        return Err("Meeting capture is running. Confirm in Dictation settings before using the microphone alongside it.".into());
    }
    let (tx, rx) = tokio::sync::mpsc::channel(2);
    {
        let mut active = voice.active.lock().map_err(err)?;
        if active.is_some() {
            return Err("Dictation already active".into());
        }
        voice
            .cancelled
            .store(false, std::sync::atomic::Ordering::Release);
        *active = Some(tx);
    }
    drop(meeting);
    let result = (|| -> Result<()> {
        let window = if let Some(w) = app.get_webview_window("dictation") {
            w
        } else {
            voice
                .ready
                .store(false, std::sync::atomic::Ordering::Release);
            tauri::WebviewWindowBuilder::new(
                &app,
                "dictation",
                tauri::WebviewUrl::App("index.html?dictation".into()),
            )
            .title("Dictation")
            .inner_size(340., 150.)
            .always_on_top(true)
            .resizable(false)
            .focused(false)
            .build()
            .map_err(err)?
        };
        let closing_app = app.clone();
        window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                let voice = closing_app.state::<VoiceState>();
                voice
                    .cancelled
                    .store(true, std::sync::atomic::Ordering::Release);
                if let Ok(active) = voice.active.lock() {
                    if let Some(tx) = active.as_ref() {
                        let _ = tx.try_send(true);
                    }
                };
            }
        });
        window.show().map_err(err)?;
        Ok(())
    })();
    if let Err(e) = result {
        *voice.active.lock().map_err(err)? = None;
        return Err(e);
    }
    let escape = "Escape".parse::<Shortcut>().map_err(err)?;
    let registered = app.global_shortcut().register(escape).is_ok();
    voice
        .escape_registered
        .store(registered, std::sync::atomic::Ordering::Release);
    if !registered {
        let _=app.emit("dictation://state",json!({"state":"preparing","notice":"Global Esc is unavailable. Use Cancel in the dictation indicator."}));
    }
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("dictation runtime");
        let result = runtime.block_on(run(&worker_app, config, prefs, rx));
        let state = worker_app.state::<VoiceState>();
        if state
            .escape_registered
            .swap(false, std::sync::atomic::Ordering::AcqRel)
        {
            let _ = worker_app.global_shortcut().unregister(escape);
        }
        if let Ok(mut active) = state.active.lock() {
            *active = None;
        }
        let _ = worker_app.emit(
            "dictation://state",
            match result {
                Ok(()) => json!({"state":"idle"}),
                Err(error) => json!({"state":"error","notice":error}),
            },
        );
        if let Some(w) = worker_app.get_webview_window("dictation") {
            let _ = w.hide();
        }
    });
    Ok(())
}
async fn run(
    app: &tauri::AppHandle,
    config: Value,
    prefs: Value,
    mut rx: tokio::sync::mpsc::Receiver<bool>,
) -> Result<()> {
    let state = app.state::<AppState>();
    let mut flow = Flow::default();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while !app
            .state::<VoiceState>()
            .ready
            .load(std::sync::atomic::Ordering::Acquire)
        {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .map_err(|_| "Dictation indicator could not open".to_owned())?;
    let engine = session::speech_engine(&state, &prefs).await?;
    let mut stt = session::begin_transcription(engine.as_ref(), &prefs).await?;
    let mut events = stt.events().ok_or("STT events unavailable")?;
    let output = tauri::async_runtime::spawn(async move {
        let mut text = String::new();
        while let Some(event) = events.next().await {
            let event = event.map_err(err)?;
            if event.is_final {
                text.push_str(&event.text);
                text.push(' ');
            }
        }
        Ok::<_, String>(text.trim().to_owned())
    });
    if (config["require_hold"] == true
        && !app
            .state::<VoiceState>()
            .key_down
            .load(std::sync::atomic::Ordering::Acquire))
        || rx.try_recv().is_ok()
    {
        output.abort();
        return Ok(());
    }
    if !app
        .get_webview_window("dictation")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
    {
        return Err("Indicator is hidden; microphone was not started".into());
    }
    let mut capture = flow.step(Phase::Listening, || {
        Capture::start(CaptureConfig {
            capture_system: false,
            mic_device: None,
        })
        .map_err(err)
    })?;
    app.emit(
        "dictation://state",
        json!({"state":"listening","cues":config["cues"]}),
    )
    .map_err(err)?;
    let cancelled = loop {
        if !app
            .get_webview_window("dictation")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
        {
            break true;
        }
        tokio::select! {
            command=rx.recv()=>break command.unwrap_or(true),
            error=capture.errors.recv()=>return Err(error.map(err).unwrap_or_else(||"Microphone disconnected".into())),
            frame=capture.frames.recv()=> {
                let frame=frame.ok_or("Microphone stopped")?;
                let level=talkkeeper_audio::rms_dbfs(&frame.samples);
                app.emit("dictation://level",json!(if level.is_finite(){level}else{-100.})).map_err(err)?;
                stt.push(AudioChunk{channel:Channel::Mic,sample_rate:16000,samples:talkkeeper_transcribe::resample(&frame.samples,frame.sample_rate).map_err(err)?,start_ms:frame.timestamp_ms}).await.map_err(err)?;
            }
        }
    };
    capture.stop();
    if cancelled {
        output.abort();
        flow.step(Phase::Cancelled, || Ok(()))?;
        app.emit("dictation://state", json!({"state":"cancelled"}))
            .map_err(err)?;
        return Ok(());
    }
    app.emit(
        "dictation://state",
        json!({"state":"transcribing","cues":config["cues"]}),
    )
    .map_err(err)?;
    flow.step(Phase::Transcribing, || Ok(()))?;
    stt.finish().await.map_err(err)?;
    let raw = output.await.map_err(err)??;
    if raw.is_empty() {
        return Err("No speech detected. Check your microphone and try again.".into());
    }
    let style = config["style"].as_str().unwrap_or("As spoken");
    let system = talkkeeper_core::dictation_prompt(style, config["prompts"][style].as_str());
    let selected = system.as_ref().and_then(|_| provider(&state).ok());
    let mut text = cleanup_text(raw, system, selected, std::time::Duration::from_secs(4)).await;
    // A cancel received during transcription or cleanup must prevent insertion.
    if app
        .state::<VoiceState>()
        .cancelled
        .load(std::sync::atomic::Ordering::Acquire)
    {
        flow.step(Phase::Cancelled, || Ok(()))?;
        app.emit("dictation://state", json!({"state":"cancelled"}))
            .map_err(err)?;
        return Ok(());
    }
    let rules: Vec<talkkeeper_core::Replacement> =
        serde_json::from_value(config["replacements"].clone()).map_err(err)?;
    text = talkkeeper_core::replace_dictation(&text, &rules);
    app.emit("dictation://state", json!({"state":"inserting"}))
        .map_err(err)?;
    if let Some(window) = app.get_webview_window("dictation") {
        window.hide().map_err(err)?;
    }
    // Give the OS focus manager time to return focus to the previous application.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let released = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while app
            .state::<VoiceState>()
            .key_down
            .load(std::sync::atomic::Ordering::Acquire)
        {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .is_ok();
    if app
        .state::<VoiceState>()
        .cancelled
        .load(std::sync::atomic::Ordering::Acquire)
    {
        flow.step(Phase::Cancelled, || Ok(()))?;
        return Ok(());
    }
    let notice = flow
        .step(Phase::Inserting, || {
            if released {
                insert(&state, &text)
            } else {
                copy_text(&state, text.clone())?;
                Err("Release the dictation hotkey, then paste the text from your clipboard.".into())
            }
        })
        .err();
    state
        .store
        .lock()
        .map_err(err)?
        .add_dictation(&text, config["days"].as_u64().unwrap_or(7) as u32)
        .map_err(err)?;
    app.emit("dictation://history", json!({"text":text,"notice":notice}))
        .map_err(err)?;
    if let Some(notice) = notice {
        return Err(notice);
    }
    flow.step(Phase::Idle, || Ok(()))?;
    Ok(())
}
async fn cleanup_text(
    raw: String,
    system: Option<String>,
    selected: Option<(Box<dyn talkkeeper_llm::LlmProvider>, String)>,
    timeout: std::time::Duration,
) -> String {
    let (Some(system), Some((provider, model))) = (system, selected) else {
        return raw;
    };
    if model.is_empty() {
        return raw;
    }
    let request = CompletionRequest {
        model,
        system,
        messages: vec![Message {
            role: Role::User,
            content: raw.clone(),
        }],
        max_tokens: Some(2048),
        temperature: None,
    };
    match tokio::time::timeout(timeout, provider.complete(request)).await {
        Ok(Ok(response)) if !response.text.trim().is_empty() => response.text,
        _ => raw,
    }
}
enum ClipboardContent {
    Text { plain: String, html: Option<String> },
    Image(arboard::ImageData<'static>),
    Files(Vec<PathBuf>),
    Empty,
}
trait PasteBoard {
    fn save(&mut self) -> Result<ClipboardContent>;
    fn restore(&mut self, saved: ClipboardContent) -> Result<()>;
    fn read(&mut self) -> Result<String>;
    fn write(&mut self, text: &str) -> Result<()>;
    fn paste(&mut self) -> Result<()>;
}
fn paste_preserving(board: &mut impl PasteBoard, text: &str) -> Result<()> {
    let previous = board.save()?;
    board.write(text)?;
    board.paste()?;
    std::thread::sleep(std::time::Duration::from_millis(350));
    if board.read().ok().as_deref() == Some(text) {
        board.restore(previous)?;
    }
    Ok(())
}
struct NativeBoard<'a>(&'a mut arboard::Clipboard);
impl PasteBoard for NativeBoard<'_> {
    fn save(&mut self) -> Result<ClipboardContent> {
        // Preserve the standard formats before replacing them with plain text.
        if let Ok(files) = self.0.get().file_list() {
            if !files.is_empty() {
                return Ok(ClipboardContent::Files(files));
            }
        }
        let plain = self.0.get_text();
        let html = self.0.get().html().ok();
        if let Some(html) = html {
            return Ok(ClipboardContent::Text {
                plain: plain.unwrap_or_default(),
                html: Some(html),
            });
        }
        if let Ok(image) = self.0.get_image() {
            return Ok(ClipboardContent::Image(image));
        }
        match plain {
            Ok(plain)=>Ok(ClipboardContent::Text{plain,html:None}),
            Err(arboard::Error::ContentNotAvailable)=>Ok(ClipboardContent::Empty),
            Err(e)=>Err(format!("Could not save clipboard: {e}. Copy the result from dictation history or the notice.")),
        }
    }
    fn restore(&mut self, saved: ClipboardContent) -> Result<()> {
        match saved {
            ClipboardContent::Text {
                plain,
                html: Some(html),
            } => self.0.set().html(html, Some(plain)).map_err(err),
            ClipboardContent::Text { plain, .. } => self.write(&plain),
            ClipboardContent::Image(image) => self.0.set_image(image).map_err(err),
            ClipboardContent::Files(files) => self.0.set().file_list(&files).map_err(err),
            ClipboardContent::Empty => self.0.clear().map_err(err),
        }
    }
    fn read(&mut self) -> Result<String> {
        self.0.get_text().map_err(err)
    }
    fn write(&mut self, text: &str) -> Result<()> {
        self.0.set_text(text).map_err(err)
    }
    fn paste(&mut self) -> Result<()> {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Err(paste_guidance().into());
        }
        let mut input =
            Enigo::new(&Settings::default()).map_err(|_| paste_guidance().to_owned())?;
        let modifier = if cfg!(target_os = "macos") {
            Key::Meta
        } else {
            Key::Control
        };
        input.key(modifier, Direction::Press).map_err(err)?;
        let pasted = input.key(Key::Unicode('v'), Direction::Click).map_err(err);
        let released = input.key(modifier, Direction::Release).map_err(err);
        pasted
            .and(released)
            .map_err(|_| paste_guidance().to_owned())
    }
}
fn insert(state: &AppState, text: &str) -> Result<()> {
    // Keep ownership alive after returning, especially for the X11 manual-paste fallback.
    let mut clipboard = state.clipboard.lock().map_err(err)?;
    if clipboard.is_none() {
        *clipboard = Some(arboard::Clipboard::new().map_err(err)?);
    }
    paste_preserving(&mut NativeBoard(clipboard.as_mut().unwrap()), text)
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fake {
        text: String,
        fail: bool,
    }
    impl PasteBoard for Fake {
        fn save(&mut self) -> Result<ClipboardContent> {
            Ok(ClipboardContent::Text {
                plain: self.text.clone(),
                html: None,
            })
        }
        fn restore(&mut self, saved: ClipboardContent) -> Result<()> {
            match saved {
                ClipboardContent::Text { plain, .. } => self.write(&plain),
                _ => unreachable!(),
            }
        }
        fn read(&mut self) -> Result<String> {
            Ok(self.text.clone())
        }
        fn write(&mut self, t: &str) -> Result<()> {
            self.text = t.into();
            Ok(())
        }
        fn paste(&mut self) -> Result<()> {
            if self.fail {
                Err("permission".into())
            } else {
                Ok(())
            }
        }
    }
    #[test]
    fn clipboard_restore_and_permission_fallback() {
        let mut b = Fake {
            text: "before".into(),
            fail: false,
        };
        paste_preserving(&mut b, "after").unwrap();
        assert_eq!(b.text, "before");
        b.fail = true;
        assert!(paste_preserving(&mut b, "after").is_err());
        assert_eq!(b.text, "after");
    }
    struct CleanupProvider(&'static str);
    #[async_trait::async_trait]
    impl talkkeeper_llm::LlmProvider for CleanupProvider {
        fn id(&self) -> &str {
            "fake"
        }
        async fn list_models(&self) -> talkkeeper_llm::Result<Vec<talkkeeper_llm::ModelInfo>> {
            Ok(vec![])
        }
        async fn complete(
            &self,
            _: CompletionRequest,
        ) -> talkkeeper_llm::Result<talkkeeper_llm::CompletionResponse> {
            if self.0 == "slow" {
                std::future::pending::<()>().await;
            }
            if self.0 == "error" {
                return Err(talkkeeper_llm::Error::Data("unavailable".into()));
            }
            Ok(talkkeeper_llm::CompletionResponse {
                text: self.0.into(),
                usage: None,
            })
        }
        async fn stream(
            &self,
            _: CompletionRequest,
        ) -> talkkeeper_llm::Result<talkkeeper_llm::TokenStream> {
            Ok(Box::pin(futures_util::stream::empty()))
        }
    }
    #[tokio::test]
    async fn cleanup_success_timeout_error_empty_and_as_spoken() {
        for (answer, expected) in [
            ("cleaned", "cleaned"),
            ("slow", "raw"),
            ("error", "raw"),
            ("", "raw"),
        ] {
            let selected = Some((
                Box::new(CleanupProvider(answer)) as Box<dyn talkkeeper_llm::LlmProvider>,
                "chosen".into(),
            ));
            assert_eq!(
                cleanup_text(
                    "raw".into(),
                    Some("Edit".into()),
                    selected,
                    std::time::Duration::from_millis(1)
                )
                .await,
                expected
            );
        }
        assert_eq!(
            cleanup_text("raw".into(), None, None, std::time::Duration::ZERO).await,
            "raw"
        );
    }
    #[test]
    fn hotkey_validation() {
        let v = json!({"hotkey":DEFAULT_HOTKEY,"mode":"toggle","style":"Clean","days":7,"cues":true,"replacements":[],"prompts":{}});
        assert!(validate(&v).is_ok());
        let mut bad = v;
        bad["hotkey"] = json!("Space");
        assert!(validate(&bad).is_err());
    }
}
