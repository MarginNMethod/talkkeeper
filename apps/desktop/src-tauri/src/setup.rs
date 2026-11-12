use super::*;
use talkkeeper_setup::{CancellationToken, OllamaRuntime, Plan, Setup};
#[derive(Default)]
pub struct SetupState {
    runtime: Mutex<Option<OllamaRuntime>>,
    cancel: Mutex<Option<CancellationToken>>,
}
#[tauri::command]
pub fn setup_status(state: tauri::State<'_, AppState>) -> Result<Value> {
    let store = state.store.lock().map_err(err)?;
    Ok(
        json!({"completed": store.get_setting("setup.completed").map_err(err)?.unwrap_or(json!(false)), "custom": store.get_setting("preferences").map_err(err)?.is_some_and(|p| p["provider"].as_str().is_some_and(|p| p != "Automatic"))}),
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
pub fn setup_cancel(state: tauri::State<'_, SetupState>) -> Result<()> {
    if let Some(token) = state.cancel.lock().map_err(err)?.as_ref() {
        token.cancel();
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
            return Err("Setup is already running".into());
        }
        *running = Some(token.clone());
    }
    let result = async {
        // Drop a previous managed child before starting again; external engines
        // are never stopped. All selected identifiers originate in the catalog.
        setup.runtime.lock().map_err(err)?.take();
        let service = Setup::new(&state.directory);
        let plan = setup_plan(state.clone())?;
        state
            .store
            .lock()
            .map_err(err)?
            .set_setting("setup.pending_plan", &json!(plan))
            .map_err(err)?;
        let runtime = service
            .run_setup(
                &plan,
                |p| {
                    let _ = app.emit("setup://progress", p);
                },
                token,
            )
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
            prefs["provider"] = json!("Automatic");
            prefs["stt_engine"] = json!("local");
            prefs["stt_model"] = json!(plan.whisper.model);
            store.set_setting("preferences", &prefs).map_err(err)?;
            store
                .set_setting("setup.completed", &json!(true))
                .map_err(err)?;
        }
        *setup.runtime.lock().map_err(err)? = Some(runtime);
        Ok(())
    }
    .await;
    setup.cancel.lock().map_err(err)?.take();
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
            return;
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
