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

## Distribution (next)

TalkKeeper is distributed as downloadable installers on the GitHub Releases page
for macOS, Windows, and Linux. It is not published to any app store. A release
workflow will build the installers from a version tag. Builds are unsigned, so the
README will explain the one-time macOS and Windows security prompts.

## Phase 3: Calendar and integrations (scope reduced)

Calendar support uses private calendar links (ICS), which Google Calendar, Outlook,
and Apple Calendar can all provide, so no developer accounts or sign-in apps are
needed: meeting titles, attendees and links, starting a note from an event, and
optional auto-start. Optional follow-ups that need no account: pre-meeting briefs
from past notes, follow-up drafts, a local MCP server, and a generic webhook. Chat
actions and service integrations (Slack, Notion, CRM, and similar) would use the
user's own tokens and stay optional. Require explicit confirmation before actions
with external effects.

## Not planned for now

Mobile apps (iPhone, iPad, Apple Watch, Android), app-store distribution, Google and
Microsoft sign-in integrations, and the self-host sync server, web app, and REST API
that mobile would need. These may return later if the project's goals change.

## Organization controls (optional, later)

SSO and SCIM; audit log; legal hold; retention policies; MDM packaging.
