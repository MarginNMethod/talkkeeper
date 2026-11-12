//! TalkKeeper desktop application entry point.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let _ = talkkeeper_core::component_name();
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run TalkKeeper desktop");
}
