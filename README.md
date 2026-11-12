# TalkKeeper

TalkKeeper is an Apache-2.0, local-first AI meeting notepad for macOS, Windows,
and Linux. The planned app captures microphone and system audio without joining
meetings as a bot. Write rough notes alongside the transcript, then turn them into
an AI-enhanced summary.

**Status: desktop core with automatic local setup.** Capture, transcription, notes,
summaries, workspace chat, reusable recipes, shared-screen snapshots, and local storage are available; later roadmap features remain planned.

## First run

Open TalkKeeper and choose **Set up automatically**. Before downloading, the app
shows estimated sizes, the model selected for your computer, and its license notes.
It then installs or reuses Ollama without administrator access, downloads local AI
and speech models, and checks that the AI answers. Progress, cancellation, and retry
are available. When **You're ready** appears, create your first note. Downloads need
a connection once; local processing works offline afterward. Low storage selects a
smaller model where possible. **Use my own AI provider instead** opens Advanced
settings, where provider and model choices remain available. Select **Automatic**
to return to the managed local AI after setup.

## Ask your notes and Recipes

Select notes in the sidebar, then open **Ask your notes**. Choose selected notes,
a folder, a creation-date range, or all notes. Answers use local FTS retrieval
with BM25 and a recency boost, display search counts, and link retrieved sources
to their transcript timestamps. Chats and removable attachments stay in SQLite.
Attach UTF-8 `.txt` or `.md` files (256 KiB each, up to eight); export PDFs as
text using `.pdf.txt` first. Cloud providers receive the retrieved context when
you ask. Recipes run only on demand, support `{{notes}}` and `{{topic}}`, and can
be edited, duplicated, imported/exported as validated JSON, copied, or saved as notes.

## People and companies

The local directory grows from note attendees, with editable profiles, meeting
history, duplicate merging and undo, attendee suggestions, and note creation with
a person. Trashed meetings are excluded. Optional AI-generated recent topics run
only on request through your selected provider. Company names derive from email
domains; free-mail exclusions are editable in `crates/core/free-mail-domains.txt`.
Enrichment uses local records only; online enrichment is a possible later opt-in.

## Voice typing

Use **Settings → Voice typing** to choose a global shortcut (initially
Cmd/Ctrl+Shift+Space), toggle or hold mode, and a cleanup style. Speak into the
visible indicator; press the shortcut again to finish, or cancel in the indicator.
The selected speech language and vocabulary apply. As spoken skips AI; Clean,
Formal, and Bullet points use editable instructions and fall back to the transcript
when AI is unavailable or takes more than four seconds. Dictionary replacements
apply afterward. Local text history defaults to seven days; set retention to zero
to disable it. Audio is never saved by dictation.

Automatic insertion uses the clipboard and Cmd/Ctrl+V. Standard clipboard contents (text, HTML, images, file lists, or an empty clipboard)
are restored after a short delay unless another app changed them. Custom
application-specific clipboard formats cannot be restored. On
Wayland or when paste permission is unavailable, text stays on the clipboard with
guidance in the main window. See [manual permission checks](docs/testing.md).

## Screen snapshots

During a meeting, choose **Capture shared screen**, confirm the privacy guidance,
and select a window or display. A visible badge shows the count and offers Stop.
Changed frames are saved every ten seconds, up to 60 JPEGs per note (1 MiB each,
1600-pixel long edge). Meeting pause and stop also halt screen capture. The gallery
links images to transcript times and supports exclusion from AI notes and deletion.
Settings offers Ask each time (default), Always on, Never, and snapshot retention.
macOS requires Screen Recording permission; Windows and Linux X11 are supported.
Wayland shows guidance to use X11. See [hand-testing steps](docs/testing.md).

## Recording consent

**Many jurisdictions require consent from all parties before recording. Users are
responsible for notifying participants and obtaining the required consent.**
TalkKeeper will offer a notify-participants helper. That helper will support the
user's responsibility; it will not determine whether recording is lawful.

## Features by phase

- **0 — Bootstrap:** Rust workspace, desktop shell, shared UI, tests, and CI.
- **1 — Desktop core:** Capture, live transcripts, notes, summaries, templates,
  search, export, trash, multiple languages, and custom vocabulary.
- **1.5 — Note conversations:** Copy full transcripts with formatting options, cited per-note chat,
  proposed note revisions, redo with instructions, and version restore. Revisions require Apply.
- **2 — Working with notes:** Multi-note and folder chat, prompt recipes, people and companies,
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

The default is local audio processing with whisper.cpp and local AI generation
with a managed Ollama engine. Recommendations live in the editable
[`model-catalog.json`](crates/setup/model-catalog.json). Cloud STT and AI providers
are optional and use your own keys; relevant content goes to your selected provider.
Secrets use the OS keychain, never SQLite or plain-text configuration.

Screen snapshots are off by default and can expose private windows, documents or
other people's information. Prefer one presentation window and obtain consent.
TalkKeeper windows are excluded, and its visible rectangles are masked in display
captures. Images remain in application data unless your selected AI model advertises
image support; cloud image transfer additionally requires explicit confirmation for
that provider and endpoint. Unknown and text-only models leave snapshots attached
without using them. Trash/restore preserves images; permanent deletion removes them.
Snapshot retention defaults to 30 days and is applied at launch.

After setup consent, downloads contact ollama.com, registry.ollama.ai and its blob
CDN hosts (including *.r2.cloudflarestorage.com), github.com release assets via
release-assets.githubusercontent.com / objects.githubusercontent.com, and
huggingface.co speech weights via cdn-lfs.huggingface.co, cdn-lfs-us-1.hf.co, or
cas-bridge.xethub.hf.co. These services deliver files; local meetings are not sent
to them. Local inference uses loopback only. No catalog refresh or large download
occurs before consent. See [setup details](crates/setup/README.md).

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
