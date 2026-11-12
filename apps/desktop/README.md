# Desktop workspace

The Tauri backend opens SQLite in the operating system's app-data directory.
Preferences contain no credentials; the `llm` and `stt` entries use the native
keychain. Custom templates live in `templates.json` beside the database.
Transcript retention runs on startup (30 days initially). No audio files are saved.

Choose an AI provider, endpoint, and model in Settings before enhancing notes.
Choose and download a speech model before starting local capture. Cloud speech
uses an explicit compatible transcription endpoint and a separate keychain entry.
Tell participants about recording and obtain consent before starting capture.
The configurable participant notice is available to copy after capture starts.

`start_note`, `start_capture`, `pause_capture`, `resume_capture`, `stop_capture`,
`enhance_note`, `list_models`, and `download_model` are native commands. The `data`
command dispatches validated storage, template, settings, credential, clipboard,
and export operations. Summary deltas and capture events include a note identifier;
model download events report downloaded and expected bytes. A bounded input queue
feeds STT while a separate task drains and persists final transcript events.
Capture errors stop the session and appear in its final state event.

The editor saves both its structured document and Markdown. Summaries remain
editable, and citations expose their source text, including citation ranges.
Exports open a native save dialog; clipboard operations retain native clipboard
ownership for desktop sessions without a clipboard manager.

## Checks

```sh
cargo fmt --all -- --check
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 cargo clippy --workspace --all-targets -- -D warnings
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 cargo test --workspace
pnpm -r lint
pnpm -r test
pnpm -r build
```

The browser test replaces the entry module with `e2e/harness.ts`, which installs
Tauri's `mockIPC` before mounting React. It covers creating and editing a note,
streaming enhancement, searching, and requesting a Markdown export. In the supplied
Linux container, use the existing Playwright runner and Chromium without downloads:

```sh
cd apps/desktop
PLAYWRIGHT_TEST_MODULE=/opt/node-tools/node_modules/playwright/test.js playwright test --trace off
```

`PLAYWRIGHT_TEST_MODULE` selects the same test module as the preinstalled runner;
it avoids loading a second runner from workspace dependencies. Outside that
container, use `pnpm exec playwright test --trace off` and adjust the Chromium
executable in `playwright.config.ts` for your installation.

Normal tests use in-memory storage, mock providers, and synthetic audio. They do
not exercise real microphone permissions, OS keychain sessions, native dialogs,
or paid cloud accounts. macOS and Windows native audio behavior needs verification
on those systems; the backend crates gate platform-specific implementations.
