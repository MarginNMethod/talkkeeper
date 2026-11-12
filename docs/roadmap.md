# Roadmap

Phases describe intended scope, not release dates. Only Phase 0 is implemented.
Recording consent, accessibility, and local data control guide every phase.

## Phase 0: Bootstrap

Create the monorepo, desktop shell, component package, tests, documentation,
license policy, wording guard, and cross-platform CI.

## Phase 1: Desktop core

Microphone and system audio capture; voice activity detection; live transcript;
notes editor; AI summary; templates; search; export; trash; multi-language support;
custom vocabulary. Default to local whisper.cpp and Ollama, with optional cloud
STT and user-key LLM providers. Provide a notify-participants helper.

## Phase 2: Working with notes

Chat over notes with citations; reusable prompt recipes; people and companies
directory; shared-screen snapshots; voice typing.

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
