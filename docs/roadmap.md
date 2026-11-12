# Roadmap

Phases describe intended scope, not release dates. The desktop core and automatic local setup are implemented.
Recording consent, accessibility, and local data control guide every phase.

## Phase 0: Bootstrap

Create the monorepo, desktop shell, component package, tests, documentation,
license policy, wording guard, and cross-platform CI.

## Phase 1: Desktop core

Microphone and system audio capture; voice activity detection; live transcript;
notes editor; AI summary; templates; search; export; trash; multi-language support;
custom vocabulary. Default to local whisper.cpp and Ollama, with optional cloud
STT and user-key LLM providers. Provide a notify-participants helper.

## Automatic local setup (implemented)

Consent-first setup, hardware/storage recommendations from an editable model catalog,
managed Ollama installation and supervision, verified speech downloads, progress,
cancel/retry, and Advanced provider settings. Local AI becomes ready without a
terminal or API key. Catalog refresh remains off and is not implemented.


## Phase 1.5 — Per-note conversations

Copy whole transcripts, ask cited questions about a note, and preview chat revisions
or redo notes with extra instructions. Apply saves the previous summary for Undo
and version restore. Multi-note and folder chat remain Phase 2.

## Phase 2: Working with notes

Implemented: workspace chat with scoped FTS retrieval, linked sources, persisted
chats, text attachments, and reusable prompt recipes with JSON sharing and saved
results. PDF context accepts exported text, not binary PDF parsing.

Shared-screen snapshots are implemented with per-meeting consent, window/display
selection, local JPEG storage, change detection and bounded capture, gallery controls,
retention, and metadata-gated image context with separate cloud consent. macOS uses
CoreGraphics without a Swift build. Wayland capture and optional local image-to-text
descriptions remain future work.

Remaining: voice typing.

People and companies are implemented with local attendee-derived profiles,
manual editing, duplicate merge/undo, meeting histories, suggestions, and optional
streamed recent topics. Online enrichment remains a possible later opt-in.

## Phase 3: Connected workflows

Google, Microsoft, and ICS calendars; pre-meeting briefs; follow-up drafts; chat
actions with confirmation; Slack, Notion, CRM, and webhook integrations; local MCP
server. Require explicit confirmation before actions with external effects.

## Phase 4: Sync and collaboration

Self-host sync server; workspaces; spaces and folders; sharing; web app; REST API;
signed webhooks. Define permissions and sync conflict behavior before rollout.

## Phase 5: Mobile capture

iOS and Android capture; watch app; optional VoIP calling. Account for platform
capture constraints and participant notification in each recording flow.

## Phase 6: Organization controls

SSO and SCIM; audit log; legal hold; retention policies; MDM packaging.

### Voice typing implementation

Global configurable dictation shortcut, toggle/hold modes, microphone-only capture,
visible level indicator, optional timed AI cleanup, editable styles, vocabulary and
literal replacement rules, and SQLite text history with retention are implemented.
Meeting capture requires explicit confirmation before concurrent dictation. Native
permissions and cross-app paste still require the hardware checks in testing.md.
