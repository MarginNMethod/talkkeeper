# Architecture

TalkKeeper uses Tauri 2 with a Rust core and React/TypeScript frontend. This document
describes the desktop core and the boundaries for future features.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/desktop/src` | Vite/React desktop interface |
| `apps/desktop/src-tauri` | Native application entry point and future IPC commands |
| `packages/ui` | Shared React components |
| `crates/core` | Domain models and storage |
| `crates/audio` | Microphone and system audio capture |
| `crates/transcribe` | STT engines and transcript production |
| `crates/setup` | Hardware recommendations, verified engine installation, managed runtime lifecycle |
| `crates/llm` | Language model provider adapters |
| `crates/templates` | Note template definitions and rendering |
| `crates/mcp` | Local MCP server |
| `crates/integrations` | Future external service adapters |

## Data flow

```text
microphone + system audio → capture → VAD → STT → transcript segments
                                                       ↓
                                              rough notes + summary
```

Capture will normalize timestamped audio frames. Voice activity detection (VAD)
will select speech intervals for STT. STT adapters will emit transcript segments
with stable identifiers, timestamps, language, and revision status. The editor
will keep user notes separate from generated output. Summary requests will combine
selected transcript segments, user notes, and an original template. Persisted
segment identifiers will support later citations and search.

Use bounded queues, cancellation, and explicit error events between stages so slow
inference cannot exhaust memory or silently discard audio. OS capture backends
will be gated by target platform. Recording begins only through an explicit user
flow that includes consent guidance and a notify-participants helper.

## Provider traits

Rust traits separate orchestration from providers. A capture trait
will expose device enumeration and a cancellable frame stream. An STT trait will
expose capabilities, language options, and segment events. An LLM trait will expose
model listing, request streaming, cancellation, and structured errors. Provider
adapters will normalize errors without logging secrets or meeting content.

Local whisper.cpp will be the default STT path, with optional cloud STT using the
user's keys. Ollama will provide local inference; Anthropic, OpenAI, and
OpenAI-compatible endpoints will be optional adapters. Automatic model identifiers come exclusively from the bundled, validated setup
catalog. Advanced settings allow explicit provider/model selection. Provider selection and cloud data transfer must be visible to the user.

The core owns storage contracts and SQLite migrations. SQLite and
plain-text settings must never contain secrets. Credential references will resolve
through the `keyring` crate into the OS keychain. Platform keychain availability
must be checked rather than falling back to a plain-text store. The core implements SQLite persistence and the desktop resolves credentials through
the OS keychain for provider calls.

Keep Tauri commands narrow and validate their inputs. Add only the capabilities
needed by implemented features; no shell or filesystem plugin access is granted by
this scaffold. Shared UI components contain no provider credentials or storage logic.

## First-run provisioning

The UI calls `setup_status` and `setup_plan` without starting a runtime or making
network requests. Consent triggers `setup_run`; `setup://progress` reports ordered
stages and byte/percent progress. `setup_cancel` cancels the current operation.
`talkkeeper-setup` selects a RAM tier and falls back for storage pressure, reuses
an external loopback engine or supervises an owned child, verifies archive checksums,
downloads speech weights through the existing model manager, and verifies an answer
through the LLM adapter. Only then does desktop persist completion in core Settings.
An in-progress plan survives failure/restart. Automatic provider resolution reads
the saved model and active port, rather than relying on a model constant. On later
launches a completed setup attaches/starts in the background without downloading.
The managed runtime owner stops its child on application exit; existing user engines
remain running. See `crates/setup/README.md` for download hosts and integrity policy.
