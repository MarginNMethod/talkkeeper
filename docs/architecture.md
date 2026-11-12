# Architecture

TalkKeeper uses Tauri 2 with a Rust core and React/TypeScript frontend. This document
describes the intended design; Phase 0 includes component stubs and a desktop shell.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/desktop/src` | Vite/React desktop interface |
| `apps/desktop/src-tauri` | Native application entry point and future IPC commands |
| `packages/ui` | Shared React components |
| `crates/core` | Domain models and storage |
| `crates/audio` | Microphone and system audio capture |
| `crates/transcribe` | STT engines and transcript production |
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

Future Rust traits will separate orchestration from providers. A capture trait
will expose device enumeration and a cancellable frame stream. An STT trait will
expose capabilities, language options, and segment events. An LLM trait will expose
model listing, request streaming, cancellation, and structured errors. Provider
adapters will normalize errors without logging secrets or meeting content.

Local whisper.cpp will be the default STT path, with optional cloud STT using the
user's keys. Ollama will provide local inference; Anthropic, OpenAI, and
OpenAI-compatible endpoints will be optional adapters. Model identifiers come from
the provider's model list or explicit user settings. There is no hard-coded default
LLM model. Provider selection and cloud data transfer must be visible to the user.

The core will own storage contracts and future SQLite migrations. SQLite and
plain-text settings must never contain secrets. Credential references will resolve
through the `keyring` crate into the OS keychain. Platform keychain availability
must be checked rather than falling back to a plain-text store. The scaffold does
not yet implement traits, persistence, credentials, capture, or provider calls.

Keep Tauri commands narrow and validate their inputs. Add only the capabilities
needed by implemented features; no shell or filesystem plugin access is granted by
this scaffold. Shared UI components contain no provider credentials or storage logic.
