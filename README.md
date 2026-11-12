# TalkKeeper

TalkKeeper is an Apache-2.0, local-first AI meeting notepad for macOS, Windows,
and Linux. The planned app captures microphone and system audio without joining
meetings as a bot. Write rough notes alongside the transcript, then turn them into
an AI-enhanced summary.

**Status: Phase 0 scaffold.** The desktop currently shows a placeholder home screen.
Capture, storage, transcription, and AI features are planned, not implemented.

## Recording consent

**Many jurisdictions require consent from all parties before recording. Users are
responsible for notifying participants and obtaining the required consent.**
TalkKeeper will offer a notify-participants helper. That helper will support the
user's responsibility; it will not determine whether recording is lawful.

## Features by phase

- **0 — Bootstrap:** Rust workspace, desktop shell, shared UI, tests, and CI.
- **1 — Desktop core:** Capture, live transcripts, notes, summaries, templates,
  search, export, trash, multiple languages, and custom vocabulary.
- **2 — Working with notes:** Cited chat, prompt recipes, people and companies,
  shared-screen snapshots, and voice typing.
- **3 — Connected workflows:** Calendars, briefs, follow-up drafts, confirmed chat
  actions, integrations, and a local MCP server.
- **4 — Collaboration:** Self-hosted sync, workspaces, folders, sharing, web app,
  REST API, and signed webhooks.
- **5 — Mobile:** iOS/Android capture, watch app, and optional VoIP calling.
- **6 — Organization controls:** SSO/SCIM, audit log, legal hold, retention, and MDM.

See [the roadmap](docs/roadmap.md) for scope and [architecture](docs/architecture.md)
for the intended design.

## Privacy and local-first operation

The intended default is local audio processing with whisper.cpp and local summary
generation with Ollama. Cloud STT and Anthropic, OpenAI, or OpenAI-compatible LLM
providers will be optional and use the user's own keys. Cloud processing will send
the relevant content to the selected provider. Users must choose a model from the
provider's model list or settings; no LLM model identifier is a default.

Secrets will be stored through the Rust `keyring` crate in the OS keychain, never
in SQLite or plain-text configuration. These integrations are future work; the
scaffold does not collect audio, store keys, or contact AI providers.

## Developer quick start

Install Rust stable, Node.js 22, Corepack, and the platform prerequisites for Tauri 2.
On Ubuntu 24.04:

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libasound2-dev libpulse-dev libayatana-appindicator3-dev librsvg2-dev
corepack enable
pnpm install
pnpm --filter @talkkeeper/desktop tauri dev
```

**macOS system audio.** Capturing computer audio on macOS uses ScreenCaptureKit, whose Rust
binding only compiles with Xcode 26 or newer (the macOS 26 SDK). By default the desktop
app is built without it, so it runs with microphone capture only. With a recent Xcode:

```sh
pnpm --filter @talkkeeper/desktop tauri dev -- --features macos-system-audio
```

For the browser-only placeholder: `pnpm --filter @talkkeeper/desktop dev`.
macOS requires Xcode Command Line Tools; Windows requires the MSVC C++ build tools
and WebView2 runtime.

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm -r test
pnpm -r build
bash scripts/ip-guard.sh
```

The JavaScript build compiles the frontend. To package the native app, run
`pnpm --filter @talkkeeper/desktop tauri build` (not needed for scaffold checks).
Use `cargo deny check licenses` to audit Rust dependency licenses. Dependencies
must use the permissive licenses allowed by `deny.toml`; check JavaScript
licenses when adding or updating dependencies as well.

The wording guard reads comma-separated `IP_GUARD_TERMS` and optional local
`.ip-guard-terms` (one literal term per line). The local file is ignored; never
commit its contents. The guard scans git-tracked text files case-insensitively.

Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities using
[SECURITY.md](SECURITY.md).
