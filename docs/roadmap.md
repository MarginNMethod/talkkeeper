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

## Phase 2: Working with notes (complete)

Implemented: workspace chat with scoped FTS retrieval, linked sources, persisted
chats, text attachments, and reusable prompt recipes with JSON sharing and saved
results. PDF context accepts exported text, not binary PDF parsing.

Shared-screen snapshots are implemented with per-meeting consent, window/display
selection, local JPEG storage, change detection and bounded capture, gallery controls,
retention, and metadata-gated image context with separate cloud consent. macOS uses
CoreGraphics without a Swift build. Wayland capture and optional local image-to-text
descriptions remain future work.

Voice typing: a global dictation shortcut (toggle or hold), a visible indicator,
optional timed AI cleanup with editable styles, vocabulary and replacement rules,
and a local text history with retention. Meeting capture needs explicit confirmation
before concurrent dictation. Native permissions and cross-app paste need the hand
checks in testing.md.

People and companies are implemented with local attendee-derived profiles,
manual editing, duplicate merge/undo, meeting histories, suggestions, and optional
streamed recent topics. Online enrichment remains a possible later opt-in.

## Phase 3: Connected workflows

Calendars come first (Google, Microsoft, and ICS links, which also cover Apple
Calendar): meeting titles, attendees and links, starting a note from an event, and
optional auto-start. Each user creates their own Google and Microsoft developer apps;
setup guides will walk through it. Then pre-meeting briefs; follow-up drafts; chat
actions with confirmation; Slack, Notion, CRM, and webhook integrations; local MCP
server. Require explicit confirmation before actions with external effects.

## Phase 4: Sync and collaboration

Self-host sync server; workspaces; spaces and folders; sharing; web app; REST API;
signed webhooks. Define permissions and sync conflict behavior before rollout.

## Phase 5: Mobile capture

Apple devices are the priority: an iPhone and iPad app (in-person capture, typed
notes, sync, and chat), plus an Apple Watch app that records offline and hands off to
the iPhone. The Mac app already exists as the desktop app. This needs the Phase 4 sync
server and an Apple Developer account. Android follows. iOS cannot capture other apps'
audio or phone calls, so capture uses the device microphone; optional VoIP calling is
a later, separate feature. Account for platform capture constraints and participant
notification in each recording flow.

## Phase 6: Organization controls

SSO and SCIM; audit log; legal hold; retention policies; MDM packaging.
