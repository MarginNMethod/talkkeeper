# TalkKeeper redesign: audit and foundation

Scope: package 1 establishes tokens, local fonts, reusable primitives and visual
capture. Screen proposals below are for subsequent packages; navigation, saving,
recording, privacy prompts and screen layouts stay as implemented today.

## Screen audit

### App shell, note index and search — App.tsx, SidebarIcon.tsx
- Today: a 250px sidebar holds branding, search, note creation, navigation,
  folders and note selection. The main area switches among notes, Today,
  directories, workspace chat and Settings. Trash and destructive confirmations
  share the shell. Saving is debounced and flushed when switching notes.
- Clutter: navigation, folder management and individual notes compete in one
  column; selected states combine coloured fills and inset stripes. Many actions
  look equally prominent. The empty workspace lacks a distinct Home hierarchy.
- Target: slim persistent navigation; Home owns the searchable, day-grouped note
  index. Keep one visible creation action. Move infrequent management actions
  into keyboard-accessible menus. Keep trash recoverable and confirmations clear.
- Extract later: AppSidebar, NavigationItem, SpaceTree, NoteRow, DayGroup,
  SearchField, ConfirmDialog. Use Row/IconButton/Popover as building blocks.

### Today and calendar — Calendar.tsx
- Today: Agenda groups events by date, shows times, attendee counts, current
  meeting state, join links and linked-note creation/opening. Reminders appear
  separately. CalendarLink shows a linked event or suggests a current event.
  CalendarSettings manages secret URLs, file import, testing, colours, refresh,
  removal, reminders, automatic capture and summary context.
- Clutter: repeated article text and full buttons make events tall; calendar
  configuration mixes setup, routine status and sensitive automation options.
- Target: a rounded Coming up card on Home with compact event rows, time in a
  consistent column and one primary action per event. Keep participant consent
  guidance visible at capture time. Move source management into settings rows;
  disclose import instructions and advanced options on demand.
- Extract later: UpcomingCard, EventRow, LinkedEventPill, CalendarSourceRow,
  PrivateLinkField, ReminderToast. Never auto-enable capture during redesign.

### Note page and metadata — App.tsx
- Today: editable title, people and folder metadata, linked calendar context,
  capture controls, templates, enhancement, exports, copy, delete and restore
  surround the note workspace. Some metadata and actions use details disclosures.
- Clutter: recording, editing and document management each demand attention;
  title looks like a form field; there is no single quiet document header.
- Target: large unboxed editable title, muted date/person/space line, restrained
  top actions, recording status near the document. Keep advanced metadata and
  exports behind labelled menus; retain explicit error and saved-state feedback.
- Extract later: NoteHeader, MetadataLine, AttendeePicker, SpacePicker,
  NoteActions, ExportMenu. Preserve save flushing and read-only trash behavior.

### Editing and written-up notes — NoteWorkspace.tsx, Editor.tsx, Summary.tsx
- Today: My notes and Written-up notes tabs; narrow windows add a Transcript
  tab, wider windows show transcript alongside. Tabs support arrows/Home/End.
  The rich editor supports formatting; summaries can switch to textarea editing
  and include citation links/disclosures. Generation selects the written-up tab.
- Clutter: tabs, generation controls and edit controls form several toolbars;
  transcript splits compete with the reading area.
- Target: one calm writing column, concise tabs and contextual formatting.
  Written-up content uses the same reading measure; provenance stays reachable.
  Keep the established narrow-screen tab behavior until replaced deliberately.
- Extract later: DocumentTabs, EditorToolbar, SummaryActions, CitationLink.
  Retain keyboard navigation, editable content and generation status semantics.

### Recording — RecordBar.tsx, CaptureFeedback.tsx, RecordingConsent.tsx
- Today: status-dependent Record/Pause/Resume/Stop controls, elapsed timer,
  microphone selection, source levels, screen capture, overflow controls and
  cross-note recording navigation. Feedback covers starting/finishing, missing
  speech models, downloads, quiet input, lag, failures and suggested stopping.
  Consent is an explicit dialog before first recording.
- Clutter: many transient states can expand the same area; diagnostic messages
  and routine controls have similar weight.
- Target: compact rounded recording strip with a stable timer and Stop action;
  put optional source controls in a popover. Show actionable warnings beside the
  strip, without shifting the editor repeatedly. Keep cross-note identity clear.
- Extract later: RecordingStrip, SourceMeter, MicrophoneMenu, CaptureNotice,
  DownloadProgress, ConsentDialog. State and elapsed time must never rely on colour.

### Transcript — Transcript.tsx, CopyTranscript.tsx
- Today: expandable transcript, search, matching segments, time/speaker lines,
  copy, expiry information and empty/recording states; citation navigation can
  highlight a segment. Speaker information can be edited.
- Clutter: repeated timestamps and controls fragment reading; retention and
  search compete with the content heading.
- Target: quiet secondary pane, one search field, aligned timestamps, muted
  speaker labels, readable utterance spacing. Keep selected citation highlights
  and expiry information visible. Empty states explain how content arrives.
- Extract later: TranscriptPane, TranscriptLine, SpeakerLabel, ExpiryNotice,
  TranscriptSearch. Do not hide copy or editing from keyboard users.

### Note chat — Chat.tsx
- Today: per-note conversation, message composer, streamed replies, suggested
  edits with Apply/Undo, version history and citation navigation. Users can
  inspect earlier versions and retain control over applying changes.
- Clutter: conversation, patch controls and version history mix in one stack;
  machine-oriented role labels interrupt the flow.
- Target: optional note-side conversation with a simple composer, quiet message
  grouping, a distinct review card for changes, and history behind a disclosure.
- Extract later: MessageList, ChatComposer, SuggestedEditCard, VersionList.
  Retain explicit Apply/Undo and show errors without replacing the draft.

### Workspace chat — WorkspaceChat.tsx
- Today: scope selection (all/selected/folder/date), included-note pills,
  saved chats, saved questions and editing/import/export, topic, attachments,
  streamed answers, retrieval statistics, citations, copy and save-as-note.
  Online-provider disclosure explains data leaving the device.
- Clutter: configuration and recipe administration occupy more space than asking
  a question; many pills and selectors precede the conversation.
- Target: Chat opens with conversation and a rounded Ask anything composer;
  scope and attachments become small labelled controls. Saved questions get a
  separate picker/editor. Keep sources near answers and technical counts in a
  disclosure. Preserve online-service disclosure and attachment limits.
- Extract later: AskBar, ScopePicker, IncludedNotes, SavedQuestionPicker,
  QuestionEditor, AttachmentChip, AnswerSources. Do not change retrieval scope.

### People and companies — People.tsx
- Today: searchable/sortable directories with meeting counts, selected-person
  editing, company association, meeting history, recent topic generation,
  duplicate suggestions, merge confirmation/undo and note creation for a person.
- Clutter: directory management, generated topics and meeting browsing share one
  surface; duplicate tooling is visually similar to ordinary browsing.
- Target: quiet avatar rows, a compact person header, day-grouped related notes;
  editing and duplicate resolution use distinct panels. Keep merge undo visible.
- Extract later: PersonRow, PersonHeader, MeetingHistory, PersonEditor,
  DuplicateReview. Keep company and individual identities distinguishable.

### Screen pictures — Snapshots.tsx
- Today: source consent dialog, source selection/preview, capture enable/disable,
  picture count, timestamped gallery, exclude-from-summary controls, deletion
  and unsupported-model guidance. Local image access uses Tauri asset URLs.
- Clutter: preview, legal consent, configuration and gallery actions accumulate;
  repeated controls around thumbnails reduce scanability.
- Target: compact gallery tiles with time and accessible action menus; show
  source/consent configuration only when enabling. Keep saved-but-unused state
  and exclusions legible, with no implied image support from the active model.
- Extract later: SnapshotGallery, SnapshotTile, SourceConsentDialog, SourcePicker.

### Settings — Settings.tsx, McpSettings.tsx
- Today: Recording, Privacy and storage, voice typing, Calendars and Advanced
  sections. Advanced contains summary providers/models, speech engines and
  access from external AI apps. Save/Close tracks dirty state and asks about
  unsaved changes; transcript deletion has its own confirmation. MCP switches
  apply immediately and provide configuration snippets and access history.
- Clutter: a long form combines routine choices, diagnostics and integration
  snippets; immediate and deferred settings have different save semantics.
- Target: short labelled sections with setting rows, descriptions beneath labels
  and explicit save status. Separate advanced integrations from daily settings.
  Preserve password fields, destructive confirmations and immediate MCP behavior.
- Extract later: SettingsSection, SettingRow, ProviderForm, ModelDownloadRow,
  StoragePolicy, IntegrationConfig, SaveFooter, UnsavedChangesDialog.

### First run and setup progress — Setup.tsx, SetupCard.tsx, useSetup.ts
- Today: a welcome screen with recommended local setup, download/storage plan,
  Get started and own-provider path. Own-provider form tests credentials/model
  choices. SetupCard persists download progress with pause/resume/retry and
  independent speech/AI readiness. Failures offer recovery and technical details.
- Clutter: hardware/download detail can overshadow the first action; setup
  errors carry both explanation and implementation diagnostics.
- Target: single welcoming card, brief local-storage explanation, one start
  action and secondary provider link. Keep download sizes before consent;
  use a persistent compact progress card once writing starts. Expand diagnostics
  only on request. Never block ordinary typing while models download.
- Extract later: WelcomePanel, SetupPlan, SetupProgress, ProviderSetup,
  RecoverableError. Preserve keyboard entry and focus into the first note.

### Voice typing — Dictation.tsx
- Today: settings for shortcut, microphone, cleanup mode and model, permissions
  check, test action, local history and clear/delete controls. A separate small
  indicator window reflects capture states; notices report paste limitations.
- Clutter: operational setup and stored history have little visual separation.
- Target: concise settings rows and a separately titled history list; keep the
  indicator compact and readable in both themes. Show permission recovery next
  to the failed action and keep clipboard fallback explanations visible.
- Extract later: ShortcutField, PermissionStatus, DictationHistoryRow,
  DictationIndicatorSurface. Preserve indicator-window routing.

### Templates — Templates.tsx
- Today: a details panel edits named summary styles and prompts with save/delete
  operations, alongside the note's style choice.
- Clutter: prompt administration appears in the writing flow.
- Target: short style picker in the note, dedicated style editor reached through
  a labelled management action. Keep user-written prompts intact.
- Extract later: StylePicker, StyleEditor, StyleRow.

## Target design specification

### Shell and navigation
- Sidebar: 208px on wide windows, 184px on compact desktop; 16px padding.
  Own TalkKeeper identity, Home and Chat first, then Spaces/folders. User/settings
  anchor at the bottom. Secondary directory and trash links remain reachable.
- Navigation rows: 40px minimum, 8px corners, 16px original icons and text labels;
  active state uses a soft accent fill and explicit current-page semantics.
- Top bar: 48px minimum, breadcrumb or space context on the left, search and
  labelled overflow on the right. One hairline separator at most; no duplicate
  page title. Window dragging must exclude all interactive controls.
- Keep keyboard focus visible, native hit targets at least 32px on desktop and
  44px for primary touch controls. Collapse navigation deliberately on narrow
  windows; do not compress document content into unreadable columns.

### Home
- Content max-width 960px, centred, 48px top/side gutters on wide windows,
  24px on compact windows. Serif page title at 40px, concise contextual date.
- Coming up card: 16px corners, 24px padding, quiet event rows with aligned time,
  title and Start notes/Open note action. Empty calendar state links to setup.
- Notes grouped by local day: 12px muted group label, 16px separation before
  groups, 48–56px rows, title and muted metadata. No card around each note.
- Ask anything bar: rounded pill-like surface, 56px minimum height, max-width
  680px, 24px from viewport bottom, floating shadow. Reserve bottom content
  padding so rows and focus are never covered. Scope is explicit when changed.

### Space page
- Breadcrumb, serif space title, optional description and one New note action.
  Same day groups and Row treatment as Home, scoped to the selected folder.
- Rename/delete and membership metadata live in labelled menus; folder identity
  stays visible while asking questions. Empty state provides a creation action.

### Note page
- Reading column 720px, expandable transcript pane 320px; respect compact tabs.
  Editable title 32px/1.15, growing naturally without truncation. Metadata 14px.
- Editor body 16px/1.5. Paragraph spacing 16px, section spacing 24–32px.
  Keep title and writing area visually unboxed while maintaining focus outlines.
- Minimal header actions, contextual formatting, recording strip and optional
  chat pane. No permanent wall of export/settings buttons. Preserve timestamps,
  citations, errors, save status and consent at the moment they matter.

### Settings and first run
- Settings max-width 760px, section spacing 32px; rows use a clear label,
  explanatory text and control. Long descriptions wrap below the label.
  Sensitive actions use danger colour plus text; advanced details start closed.
- First run max-width 560px, warm surface, serif welcome title, single primary
  action and optional provider path. Download progress remains available after
  entering the editor. Readiness and failure use words as well as colour.

### Typography and rhythm
- Local Inter variable for controls/body; local Newsreader variable for display
  headings. No remote font requests. System sans and ui-serif/Georgia fallbacks
  cover missing glyphs and loading. Use original wording and iconography.
- Type tokens: xs 12, sm 14, base 16, lg 18, xl 24, title 32, display 40px
  at a 16px root. Body leading 1.5; display/title 1.15. Weight 400 body,
  500 controls, 600 emphasis. Avoid all-caps navigation and tiny grey body copy.
- Spacing tokens s0–s8: 0, 4, 8, 12, 16, 24, 32, 48, 64px.
  Use 8px between related controls, 16px within sections, 32px between sections.
- Radius tokens: sm/legacy radius 8px, md 12px, lg 16px, pill 999px.
  Use pills for compact metadata/composers, not every content container.

### Colour and elevation
- Light: warm canvas #f7f5f0, panel #fffefa, sunken #eeece5; text #292923,
  secondary #606057, tertiary #707067. Dark: canvas #201f1c, panel #292824,
  sunken #33322d; text #eeece4, secondary #bcb9ae, tertiary #a6a398.
- Green accent: #34654e light / #a4c7ac dark; on-accent text #fff / #202b23.
  Accent is reserved for selection, links, focus and primary actions.
- Hairline borders #dcdad1 / #46453e distinguish surfaces; stronger borders
  #85857a / #858276 identify input boundaries. Do not use faint decorative
  borders as the sole means to identify a control.
- Danger and warning have separate text/fill roles. All text levels target
  WCAG AA 4.5:1 on their intended surfaces; focus/control boundaries target 3:1.
  Disabled controls are explicitly disabled, never just muted labels.
- Floating shadow: 0 8px 32px with warm 12.5% ink in light, 25% black in dark.
  Ordinary rows use no shadows; menus/composers may use one elevation level.
- OS colour preference is default. tk-theme persists light/dark overrides;
  system removes the override. No appearance UI is introduced in this package.

### Motion and interaction
- 120ms colour/hover transitions, 180ms simple disclosure transitions;
  easing cubic-bezier(.2,0,0,1). No bouncing, looping decoration or page slides.
- Respect prefers-reduced-motion: remove nonessential transitions. Recording
  state must remain understandable without animation.
- Hover actions also appear on focus-within and touch devices. Popovers use
  labelled native button triggers, expanded state, initial content focus,
  Escape dismissal and return focus. Non-modal panels keep natural Tab order.
  Future destructive dialogs require a separate modal primitive and focus trap.

## Foundation verification and capture

- Shared primitives are deliberately unused by screens in this package. Their
  styles use tk- classes to avoid collisions with existing screen selectors.
- Font assets and complete OFL texts live in src/fonts; NOTICE credits both.
  deny.toml and the licenses CI job audit Rust crates, not static font assets;
  no Rust dependency allowance is needed for these bundled files.
- Run the ordinary lint, unit, build and browser suites before visual capture.
- Opt-in capture: from apps/desktop run
  `SHOTS=1 PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec playwright test e2e/shots.spec.ts --reporter=line`.
  PNGs go to ignored e2e/screenshots. Capture Home/current landing, calendar,
  populated note/transcript, note chat, workspace chat, people, companies,
  settings and first run in light and dark. These are baseline records of the
  existing layouts, not approval of the future screen proposals above.
