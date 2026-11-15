# UX review 03: Clarity — wording, hierarchy, navigation and Settings

Scope: the sidebar and app shell, visual styling, vocabulary, the Settings screen, empty states,
error tone and accessibility basics. Setup and the mechanics of recording are covered in the other
notes; here they appear only where wording or hierarchy is the problem.

Sources read: all twelve screenshots, `App.tsx`, `Settings.tsx`, `style.css` (the only stylesheet
in `apps/desktop/src`), `McpSettings.tsx`, `Setup.tsx`, `Transcript.tsx`, `Templates.tsx`,
`CopyTranscript.tsx`, and the labels in `Calendar.tsx`, `People.tsx`, `Dictation.tsx`,
`Snapshots.tsx`, `Chat.tsx`, `WorkspaceChat.tsx`, `Editor.tsx`. All paths below are relative to
`apps/desktop/src` unless stated.

## 1. Verdict

Nothing on any screen tells a first-time user what to do next, because every control is the same
white button with a pale grey outline: "New note", "Trash", "Start capture" and "Clear key" all
carry identical weight, and the one action the app exists for (record a meeting) has no colour, no
size and a name ("Start capture") that ordinary people do not use. The app speaks three dialects
for the same thing ("capture", "recording", "conversation", "note"; "Enhance", "Summary", "Redo
enhanced notes"; "dictation", "voice typing") and leaks implementation words into the interface
("STT endpoint", "Local whisper.cpp", "Base URL", "MCP executable", "stdio", raw `Error: ...`
strings, raw ISO timestamps). Settings is one 3,500-pixel scroll that opens with a developer
integration and a privacy warning, has three different saving behaviours, and buries the two
things everyone needs (language, how long transcripts are kept) at the bottom under labels that
hide the fact that **transcripts are deleted after 30 days by default**. A single CSS rule
(`input { width: 100% }`) detaches every checkbox from its label, which is the "mystery checkbox"
in the sidebar and in Settings. There is no visible keyboard focus style anywhere, and control
borders are far below the contrast needed to see them.

## 2. Findings

Severity order. Every colour ratio quoted was computed with the WCAG relative-luminance formula.

---

### 1. Transcripts are silently deleted after 30 days, behind the label "Transcript retention days"

**Problem.** Near the bottom of Settings are two number boxes, "Snapshot retention days: 30" and
"Transcript retention days: 30". Nothing says what happens on day 31. In fact the transcript of
every meeting is permanently deleted (the note and summary stay). There is no "keep forever"
choice; the largest value is 36500. Entering 0 makes the cutoff "now", which deletes every
transcript at the next clean-up.

**Where.** `Settings.tsx:218-228`; behaviour in `crates/core/src/store.rs:361-375`,
`crates/core/src/snapshots.rs:165`, invoked from `src-tauri/src/main.rs:600-608`. Screenshot
`12-settings-full`. In the note view nothing warns that a transcript will expire; the only trace
is "This segment has been removed or expired." (`Summary.tsx:62`).

**Why it hurts.** "Retention" is records-management jargon. A user who records an important
meeting and comes back six weeks later finds the transcript gone, with no warning and no way to
get it back. This is data loss by unexplained default — worse than any layout problem.

**Proposed change.**
- Replace both number boxes with dropdowns in a "Privacy and storage" section (finding 4):
  - Label: **Keep transcripts for** — options: `30 days`, `90 days`, `1 year`, `Forever`.
    Hint underneath: "After this, the word-for-word transcript is deleted. Your notes and
    summaries are always kept."
  - Label: **Keep screen pictures for** — same options. Hint: "After this, pictures taken
    of your screen during a meeting are deleted."
  - Map `Forever` to the existing maximum (36500) so no backend change is required. If the stored
    value matches none of the options, add an option "`{n}` days" so nothing is silently changed.
- Decide the default deliberately. Recommendation: default to **Forever** for transcripts (the
  product promise is "find the details that matter"), keep 30 days for screen pictures.
- In the note view, when a transcript is within 7 days of deletion, show one quiet line above the
  transcript: "This transcript will be deleted on 14 December. Change this in Settings."
  ("Settings" is a link that opens Settings at Privacy and storage.)
- When a transcript has already been deleted, the Transcript column shows: "The transcript for
  this meeting was deleted after 30 days, as chosen in Settings. Your notes and summary are still
  here."

**Done when.** The words "retention" and "days" as a bare number box no longer appear; a user can
choose "Forever"; a note whose transcript is 25 days old (with a 30-day setting) shows the
deletion date; a note whose transcript was removed explains why.

**Severity.** Must-fix.

---

### 2. No visual hierarchy: every action is the same grey outlined button

**Problem.** `style.css` defines exactly one button style (white fill, 1px `#d7dfd8` border). It
is used for navigation (Notes, People), creation (New note), the app's core action (Start
capture), destructive actions (Move to trash, Delete folder, Clear key), formatting (Bold),
suggestion chips (List action items) and settings (Store key in keychain). Hover and "selected"
share one colour (`button:hover, .active`), so hovering any button makes it look selected — see
"Rewrite these notes shorter" in `09-note-view`, which looks active only because the pointer is
over it. Navigation buttons are centre-aligned boxes; nothing shows which view you are in.
The `--accent` variable exists but is used only for citation links (`style.css:192`).

**Where.** `style.css:24-39`, `:86-90`; every screenshot, most clearly `08-main-default`,
`09-note-view`, `12-settings-full`.

**Why it hurts.** With nothing emphasised, the user has to read every label to find the one that
matters. In the note view there are roughly 30 same-looking buttons on screen; "Start capture" is
the eleventh thing in reading order and looks exactly like "Italic".

**Proposed change.** Adopt the visual system in section 4 ("Visual system"). The rules that
matter most:
- **One primary (filled accent) button per screen region.** Sidebar: "New note". Note view when
  idle: "Start recording". Setup: "Set up TalkKeeper". Settings: "Save changes". Dialogs: the
  confirming action.
- **Recording is the only thing that is ever red.** While recording, "Stop recording" is a
  filled red button and the status chip is red with a dot.
- **Navigation is not a button.** Sidebar destinations are flat, left-aligned rows with an icon;
  the current one has a tinted background and `aria-current="page"`.
- **Everything else is secondary (outlined) or quiet (text-only).** Formatting buttons, chips,
  "Copy", "Export", "Dismiss" are quiet.
- **Destructive actions** are quiet with red text, and filled red only inside their confirmation.
- Split `button:hover` from `.active`; selection must never be the same colour as hover.

**Done when.** On each of the twelve screens exactly one filled accent button is visible (or one
filled red "Stop recording" while recording); the current sidebar destination is visibly marked
without hovering; hovering a button never makes it identical to a selected item.

**Severity.** Must-fix.

---

### 3. The sidebar offers eleven equal choices before the user has made a single note

**Problem.** A brand-new user sees, top to bottom: Today & upcoming, Ask your notes, New note,
a search box, Notes, People, Companies, Trash, a "Folder" dropdown, New folder (plus Rename
folder and Delete folder once one is selected), then the note list, then Settings. Creation, a
search field, navigation, a filter, folder management and a list are interleaved in one column
of identical boxes. Specific faults:
- "New note" is third, between a navigation item and a search box, and during setup it is a
  dimmed box with no explanation (`01-setup-first-launch`).
- "Notes" and "Trash" are not views like People; they silently toggle what the list below shows
  (`App.tsx:251-259`, `:276`), and nothing marks which is on.
- The search box says "Search conversations" but its accessible name is "Search notes"
  (`App.tsx:246-247`), and the list it searches is called "Notes".
- A lone checkbox floats centred above the date heading (`09-note-view`). It is the "select this
  note for Ask your notes" box (`App.tsx:340`); it has an `aria-label` but no visible label, sits
  on its own row because of the CSS in finding 6, and its purpose is discoverable only by opening
  "Ask your notes" and reading the "Selected notes" scope option.
- "New folder" and "Rename folder" open a bare system prompt titled "Folder name" / "Rename
  folder" (`App.tsx:290`, `:306`). "Delete folder" deletes immediately with no confirmation and
  no statement about what happens to the notes inside (`App.tsx:319-332`).
- "People" and "Companies" are empty for a new user and "Ask your notes" is useless with zero
  notes, yet all three sit above the user's own notes.
- Dates render as `11/15/2026` in a heading per day; with one note per day the list is half
  headings.

**Where.** `App.tsx:226-363`; `08-main-default`, `09-note-view`, `01-setup-first-launch`.

**Why it hurts.** The sidebar is the first thing read. It currently describes the app's data
model, not the user's task. The owner's word was "clunky"; this column is where that impression
forms.

**Proposed change.** Replace with the layout below. Width stays 250px. This is plain markup and
CSS; no new dependencies. Icons are inline SVG (16px, `stroke="currentColor"`, `aria-hidden`),
original line drawings: plus, magnifier, calendar, page, speech bubble, person, building, bin,
folder, cog.

```
+------------------------------------------+
| TalkKeeper                               |   h1, 1.25rem
|                                          |
| [ +  New note                          ] |   PRIMARY, full width
|                                          |
| [ (magnifier) Search notes             ] |   input, placeholder "Search notes"
|                                          |
|  (page)     Notes                    12  |   nav row, current = tinted
|  (calendar) Today                        |   nav row
|  (bubble)   Ask your notes               |   nav row
|  (person)   People                       |   nav row, hidden until 1+ person exists
|  (building) Companies                    |   nav row, hidden until 1+ company exists
|                                          |
|  FOLDERS                             [+] |   small caps group label + quiet icon button
|  (folder)   All notes                    |   selected by default
|  (folder)   Client work              [...]|   [...] appears on hover/focus: Rename, Delete
|  (folder)   Interviews               [...]|
|                                          |
|  TODAY                                   |   group label
|  | Weekly catch-up                       |   note row: title
|  | 10:02 · 24 min                        |             quiet second line
|  YESTERDAY                               |
|  | Untitled meeting                      |
|  | 16:30 · no recording                  |
|  EARLIER                                 |
|  | Budget review                         |
|  | 12 Nov                                |
|                                          |
|  ----------------------------------      |
|  (bin)  Trash                            |   nav row, quiet
|  (cog)  Settings                         |   nav row, quiet
+------------------------------------------+
```

Exact behaviour and wording:
- **New note** — primary button, first focusable item after the app name. During setup it stays
  disabled with a visible line beneath it: "Available when setup finishes." (Do not leave a
  disabled control unexplained.)
- **Search notes** — one name everywhere: placeholder "Search notes", `aria-label="Search
  notes"`. When a search is active, the list heading becomes "Results for "garden"" with a quiet
  "Clear" button, and no-match text is "No notes mention "garden"."
- **Navigation rows** — an unordered list inside `<nav aria-label="Main">`. Order: Notes, Today,
  Ask your notes, People, Companies. "Today & upcoming" is renamed **Today** (the page heading
  stays "Today and upcoming"). People and Companies appear only once at least one exists; until
  then they are reachable from an attendee's name in a note. Current row gets
  `aria-current="page"` and the selected style.
- **Folders** — replace the dropdown and three buttons with a list. "All notes" replaces "All
  folders". The `[+]` button has `aria-label="New folder"` and a tooltip "New folder". Creating
  or renaming puts an inline text field in the list (Enter saves, Esc cancels) instead of
  `window.prompt`. A row menu (`[...]`, `aria-label="Folder options for Client work"`) holds
  "Rename" and "Delete folder…". Delete asks: heading "Delete the folder "Client work"?", body
  "The 4 notes inside are kept and move to All notes.", buttons "Delete folder" (danger) and
  "Cancel". With zero folders the group shows only the label, the `[+]` and one line: "Group
  notes into folders."
- **Note list** — group labels "Today", "Yesterday", "Earlier this week", then month names
  ("November 2026"), not a heading per calendar day. Each row: title on line one; on line two a
  quiet time and length ("10:02 · 24 min"), or the search snippet when searching. A red dot and
  "Recording" replace line two for the note being recorded.
- **Selecting notes for Ask your notes** — remove the checkboxes from the sidebar. In "Ask your
  notes", when the scope is "Notes I choose", show the checklist of notes there, next to the
  thing it controls. (If engineering prefers to keep them in the sidebar, show them only while
  the Ask view is open with scope "Notes I choose", under a visible heading "Choose notes to
  ask about".)
- **Trash** and **Settings** — pinned to the bottom, quiet rows. Trash becomes a real view:
  heading "Trash", hint "Notes here can be restored. Nothing is deleted until you choose
  "Delete forever".", empty text "Trash is empty."

**Done when.** With an empty database the sidebar shows, in order, only: app name, New note,
search, Notes, Today, Ask your notes, Folders label, Trash, Settings. No unlabeled control is
visible. Every destination shows a selected state when open. No `window.prompt` or
`window.confirm` call remains in `App.tsx`. Deleting a folder asks first and says where the notes
go.

**Severity.** Must-fix.

---

### 4. Settings opens with developer and privacy-warning material; the basics are at the bottom

**Problem.** Settings is one page, 3,500px tall, in this order: Connect other AI tools (with a
bold privacy warning, "How to connect", raw timestamps and tool names), Calendars, Voice typing,
Dictation history, an unlabelled run of AI provider fields, speech engine fields, Language,
Vocabulary, Screen snapshots, two retention boxes, Participant notice, then "Save settings" and
"Close". Other faults:
- The only heading for the AI/speech block is a floating paragraph beginning "Cloud providers
  send notes or audio to the endpoint you select." (`Settings.tsx:49-52`).
- "AI provider (Advanced)" puts the word Advanced in a label rather than moving the field.
- Three saving behaviours on one page: "Connect other AI tools" switches apply instantly;
  Voice typing has its own "Save dictation settings"; everything else needs "Save settings" at
  the very bottom. Calendars says "Save settings, then refresh your calendars". "Close" discards
  changes without asking.
- "STT endpoint" and "STT API key" are shown even when the speech engine is local; "Base URL"
  and "AI API key" are shown even for the automatic local option.
- "Language" is a free-text box containing `auto`.
- "Dictation history" (content, not a setting) is in the middle of the page with an unlabelled
  search box.
- The sticky "Capture shared screen" bar and, during a recording, "Capture recording / Stop
  capture" sit over the Settings page.

**Where.** `Settings.tsx:44-248`, `McpSettings.tsx`, `Calendar.tsx:74-250`,
`Dictation.tsx:64-345`; `12-settings-full`, `03-settings-opened-during-setup`,
`05-own-provider-settings`.

**Why it hurts.** A non-technical person who opens Settings to change the language meets a
privacy warning about cloud assistants, a JSON configuration block and the word "stdio" before
anything they recognise, and concludes the app is not for them. The split saving model means
changes are lost without notice.

**Proposed change.** Five sections, shown one at a time, chosen from a short list on the left of
the Settings page (a vertical list of five links; at narrow widths it becomes a row above the
content). Order and names are fixed:

1. Recording
2. Calendar
3. Voice typing
4. Privacy and storage
5. Advanced

Page heading: "Settings". A quiet "Back to notes" link sits top-left of the page (replaces
"Close"). The full outline with every label is in section 5 ("Settings outline").

Saving: one model. Every section saves through a single sticky footer inside Settings containing
a primary **Save changes** button and a quiet **Discard changes** button; both are disabled until
something changes. The footer saves preferences and voice-typing settings together (two existing
calls behind one button). After saving, the footer shows "Saved" for 3 seconds in a
`role="status"` element. Controls that already apply instantly (the three "other AI apps"
switches, adding/removing a calendar) keep doing so and say "Applies straight away" beside them.
Leaving Settings with unsaved changes asks: heading "Save your changes?", buttons "Save
changes", "Discard", "Keep editing".

**Done when.** Opening Settings shows the Recording section first; the strings "MCP", "STT",
"Base URL", "API key", "whisper", "Ollama", "endpoint" and "stdio" do not appear unless the user
opens Advanced; there is exactly one Save button on the page; leaving with unsaved changes
prompts; choosing "On this computer" for speech hides the online-service fields.

**Severity.** Must-fix.

---

### 5. Jargon and inconsistent vocabulary throughout

**Problem.** The interface uses words that describe how the software works rather than what the
user is doing, and uses several words for one thing.
- "Capture" means recording audio ("Start capture", "Capture recording", "Stop capture",
  "Meeting capture") *and* taking pictures of the screen ("Capture shared screen"). Elsewhere the
  same act is "recording" ("Stop recording", "Keep recording", "before recording").
- A note is a "note" (New note, Notes), a "conversation" (Search conversations, Untitled
  conversation) and a "meeting" (People > Meetings).
- The AI output is "Enhance", "Enhancing…", "Summary", "enhanced notes", "Redo notes", "AI
  enhancement" and "notes revision". The disabled button reading "Use Redo notes below"
  (`App.tsx:629-633`) is an instruction disguised as a button.
- Voice typing is "Voice typing" in its heading and "Dictation" in every label under it.
- The status chip prints internal state names: "stopped", "recording", "paused"
  (`App.tsx:452-457`). "stopped" is shown on a note that has never been recorded.
- Level meters are labelled with internal source keys (`App.tsx:564-569`).
- Raw data shown to users: `2026-11-12T10:00:00Z — search_notes` (`McpSettings.tsx:63`),
  `CommandOrControl+Shift+Space` (`Dictation.tsx`), `auto` in Language, `Model download: 100%`
  (`App.tsx:120-123`), `Error: Check your connection and retry.` (`04-setup-failed`).

**Where.** Listed per row in the table in section 6.

**Why it hurts.** Each unfamiliar word is a small moment of "this isn't for me". Using two words
for one thing makes people think there are two things ("is a conversation different from a
note?").

**Proposed change.** Adopt the vocabulary rules below and the replacement table in section 6.
1. The thing in the list is always a **note**. The event is a **meeting**. Never "conversation"
   as a noun for the object. Default title: "Untitled meeting".
2. Audio is always **recording / record**. Never "capture".
3. Screen images are **screen pictures** ("Take pictures of my screen"). Never "capture",
   "snapshot".
4. The AI output is the **summary**; the action is **Write summary**; repeating it is **Write it
   again**. Never "enhance".
5. The feature is **Voice typing** everywhere. Never "dictation" in the interface.
6. Processing location is described as **On this computer** / **An online service**. Never
   "local", "cloud", "provider", "endpoint", "engine" outside Advanced.
7. Sentence case for every label and button. Buttons start with a verb. No "(Advanced)",
   "(optional)" suffixes — group advanced things under Advanced; mark optional fields with the
   hint "Optional".

**Done when.** A text search of `apps/desktop/src/*.tsx` user-visible strings finds no "capture",
"Enhance", "STT", "whisper", "dictation" (outside Advanced: "Ollama", "endpoint", "Base URL",
"MCP"); the status chip never shows a lower-case internal state name.

**Severity.** Must-fix (the recording and summary words); should-fix (the rest).

---

### 6. One CSS rule detaches every checkbox from its label

**Problem.** In Settings each checkbox sits alone in the middle of the column with its label on
the line below in small grey text ("Allow other AI tools to read notes", "Start capture
automatically when a meeting begins", "Start and stop cues"). In the chat panel the "Propose a
notes revision" checkbox floats mid-screen. The sidebar's stray checkbox has the same cause.

**Where.** `style.css:49-52` (`input, textarea { width: 100% }` applies to checkboxes, colour
pickers and number fields) and `style.css:59-64` (`label input { display: block; margin-top:
5px }`). Visible in `12-settings-full`, `09-note-view`. The colour picker in Calendars is a
full-width empty bar for the same reason.

**Why it hurts.** A checkbox 250px from its label does not look like it belongs to it. Several of
these switches have privacy consequences (letting other apps read notes, automatic recording);
the user cannot tell which box controls which.

**Proposed change.** Scope the width rule and add a checkbox row:

```css
input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="number"]),
textarea { width: 100%; }
input[type="number"] { width: 7rem; }
input[type="color"]  { width: 3rem; height: 2.25rem; padding: 2px; }

label.check {
  display: flex; align-items: flex-start; gap: 10px;
  color: var(--text); font-size: 1rem; margin: 12px 0;
}
label.check input { width: 18px; height: 18px; margin: 3px 0 0; flex: none; accent-color: var(--accent); }
label.check + .hint { margin: -6px 0 12px 28px; }
```

Add `className="check"` to every label that wraps a checkbox (`McpSettings.tsx:47`,
`Calendar.tsx` three places, `Dictation.tsx` "Start and stop cues", `Chat.tsx:239`,
`CopyTranscript.tsx`, `Transcript.tsx`). Put the box first and the label text after it in every
case.

**Done when.** Every checkbox sits immediately left of its own label on the same line, at 18px;
clicking the label text toggles it; no checkbox appears without visible text beside it.

**Severity.** Must-fix (small change, removes the most confusing visual defect).

---

### 7. The top bar: two unstyled strips, a permanently visible disabled button, and content hidden underneath

**Problem.** Above the whole app is a full-width white strip holding one button, "Capture shared
screen", which is disabled whenever nothing is being recorded — that is, on first launch, during
setup, in Settings, always. While recording a second unstyled strip appears above it: the text
"Capture recording" jammed against a "Stop capture" button, flush to the window edge
(`10-note-recording`). The lower strip is `position: sticky`, so it slides over page content
when scrolling. Stopping is offered twice within 350px ("Stop capture" at the top, "Stop" in the
note).

**Where.** `App.tsx:221` (indicator, no class, no CSS), `App.tsx:224` and `Snapshots.tsx:104-127`
(`.snapshot-controls`, `style.css:301`). Screenshots `08-main-default`, `10-note-recording`,
`12-settings-full`.

**Why it hurts.** The most prominent position in the window is spent on a secondary feature that
is unavailable, with a name that is easily read as "record my screen". The recording indicator —
the thing that must be unmissable for consent and trust — is the least designed element in the
app.

**Proposed change.**
- Remove the permanent top strip. Nothing is shown there when not recording.
- Move the screen-picture control into the note's recording area, shown only while recording, as
  a secondary button: **Take pictures of my screen**. When on, it becomes the status text
  "Taking screen pictures · 6 so far" with a quiet button **Stop taking pictures**.
- While recording, show one **recording bar** across the top of the window (above sidebar and
  content, not sticky over them — it takes its own 44px of layout height):

  `● Recording · 12:04 · Weekly catch-up` … `[Pause]` `[Stop recording]`

  Red dot (10px, not animated when `prefers-reduced-motion`), elapsed time, the note title as a
  link that opens that note, a secondary "Pause", a filled red "Stop recording". When paused:
  amber dot, "Paused · 12:04", "Resume" as primary, "Stop recording" as secondary.
- The bar is `role="region"` with `aria-label="Recording"`. The state change is announced once
  via a separate visually hidden `role="status"` element ("Recording started", "Recording
  paused", "Recording stopped. Writing your transcript."); the ticking timer is `aria-hidden` so
  it is not read every second.
- In the open note the same controls appear in place (see the other notes for the recording
  panel). When viewing the note being recorded, the bar still shows; that is acceptable
  duplication because the bar is the same component everywhere.

**Done when.** With nothing recording, no strip is visible above the app. Starting a recording
shows one bar that stays visible in every view including Settings, never overlaps content when
scrolling, and contains exactly one stop control. "Capture shared screen" appears nowhere.

**Severity.** Must-fix.

---

### 8. No visible keyboard focus, invisible control borders, and no landmarks

**Problem.**
- There is no `:focus-visible` rule at all; buttons rely on the browser default, and the note
  editor removes its outline entirely (`.tiptap { outline: none }`, `style.css:159`). The title
  field has no border and no focus style, so it does not look editable.
- Control borders are `#d7dfd8` on white: contrast **1.36:1** (1.25:1 against the page
  background). Inputs and buttons are effectively borderless for anyone with reduced contrast
  sensitivity; WCAG 1.4.11 asks for 3:1.
- Disabled buttons are `opacity: 0.45` on an already faint outline (`01-setup-first-launch`:
  "New note" is nearly invisible) and never say why they are disabled.
- Field labels, hints and the empty-state heading all use `--muted` (`#647268`, 4.67:1 on the
  page background — a pass, but only just, at 0.85rem). Labels are quieter than the values.
- The sidebar is an `<aside>` containing an `<h1>`; the actual `<nav>` wraps only the note list.
  The recording indicator is a second `<aside role="status">`. Views do not move focus or
  announce themselves when they change; opening Settings leaves focus on the sidebar button with
  the new content far away.
- Heading order is broken: Settings is `h2` then `h3` sections then an `h4`, while the AI block
  has no heading; the sidebar date labels are `h3` under an `h1`.
- `window.prompt` / `window.confirm` are used for folder names and deletions (`App.tsx:290`,
  `:306`, `:482`; `Dictation.tsx:266`; `Snapshots.tsx:313`). The in-page dialogs
  (`role="dialog"` in `People.tsx:266`, `Snapshots.tsx:130`, `:288`) have no focus trap, no
  `aria-modal`, and are not closed by Esc.
- Status and progress: "Model download: 100%" is a `role="status"` paragraph that never clears
  (`App.tsx:371`). Level meters update continuously inside `<label>` elements. The error banner
  is `role="alert"` (good) but focus is not managed and it sits at the top of the content column,
  off-screen if the user has scrolled.
- Icon-only content: the voice-typing cue "●" is correctly `aria-hidden`; keep that pattern.
- Select-all affordances are missing: transcript rows have `aria-label="Select segment 3"`
  ("segment" is jargon; use "Select line at 1:05").
- "Export" and "Copy options" are `<details>` elements that push the header layout around when
  opened (`style.css:233-244`) rather than opening as menus.

**Where.** `style.css` throughout; `App.tsx:221-227`, `:335`, `:365-371`; files cited above.

**Why it hurts.** Keyboard users cannot see where they are. Low-vision users cannot see where
the fields are. Screen-reader users get no structure and a stream of unrelated status noise.

**Proposed change.**
- Focus ring (applies to everything focusable, including the editor and the title):
  ```css
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
  .tiptap:focus-visible, .title:focus-visible { outline-offset: 0; }
  ```
  Delete `outline: none` from `.tiptap`.
- Borders: use `--border-strong` (`#7d8a81`, 3.61:1 on white) for inputs, selects, textareas and
  secondary buttons; keep the pale `--border` only for dividers and panels.
- Labels use `--text` at 0.9rem, weight 500; hints use `--muted` at 0.85rem. Disabled controls:
  `opacity: 1`, text `--muted`, background `--surface-sunken`, dashed border; plus a visible
  reason beside or under the control whenever the reason is not obvious.
- Landmarks: `<header>` for the recording bar; `<nav aria-label="Main">` for the sidebar
  (contains the navigation list, folder list and note list, each a `<ul>`); `<main>` for the
  content column (today `<main>` wraps the sidebar too). One `h1` per view — the view's name
  ("Settings", "Today and upcoming", the note title as an input with `aria-label="Note title"`
  inside an `h1`-level wrapper). The sidebar's "TalkKeeper" becomes a plain `<p class="brand">`.
- On every view change, move focus to the view's `h1` (give it `tabIndex={-1}`) and update
  `document.title` ("Settings — TalkKeeper").
- Tab order = visual order: recording bar (when shown) → sidebar (New note, search, nav, folders,
  notes, Trash, Settings) → content. Add a "Skip to content" link as the first focusable
  element, visible on focus.
- Note list keyboard support: rows are buttons inside list items (already focusable); add
  `aria-current="true"` to the open note.
- Replace every `window.prompt`/`confirm` with one small `<dialog>` component used via
  `showModal()` (native focus trap, Esc to close, returns focus to the opener). Give it
  `aria-labelledby` pointing at its heading. Convert the three hand-rolled `role="dialog"`
  blocks to the same component.
- Status announcements: one app-level polite live region (`role="status"`, visually hidden) for
  short confirmations ("Saved", "Copied 1,204 words", "Recording started"), cleared after 5
  seconds. Errors use `role="alert"` and appear next to what failed (finding 10). Progress uses
  `<progress>` with a text label and disappears when complete. Level meters get
  `aria-hidden="true"` plus one text state that changes only when it matters ("Hearing you" /
  "No sound from your microphone").
- "Export" and "Copy options" become menu buttons that open a positioned panel
  (`position: absolute` under the button) and close on Esc or outside click, so the header does
  not reflow.
- Do not rely on colour alone: recording = red **and** a dot **and** the word "Recording";
  errors = red **and** a heading; selected nav = tint **and** a 3px accent bar on the left.
- Respect `prefers-reduced-motion` for any pulsing dot (the existing `.dictation-cue` rule is the
  pattern to copy).
- Minimum target size 32×32px for buttons, 28px for quiet icon buttons with 4px spacing.

**Done when.** Tabbing from the top of the window visits every control in visual order with a
clearly visible 3px ring on each, including the note editor and title; no control border is
below 3:1; opening any view moves focus to its heading; no `window.prompt`/`confirm` remains;
Esc closes every dialog and menu and returns focus; a screen reader hears "Recording started"
once and is not interrupted by the timer or meters.

**Severity.** Must-fix (focus ring, borders, checkbox labels, dialogs); should-fix (landmarks,
focus on view change, live-region consolidation).

---

### 9. Empty states are missing or say nothing useful

**Problem.**
- Main area with no note open: "A place to collect the conversation / Create a note to write,
  record, and find the details that matter." — pleasant but there is no button; the user must
  find "New note" among the sidebar's eleven boxes. Heading and body are both muted grey, so the
  page looks disabled (`08-main-default`).
- Note list with no notes: nothing at all.
- Transcript column before recording: a search box, "Copy transcript", "Copy options" and a
  disabled "Delete selected" above empty space. Tools for something that does not exist.
- Summary before it is written: an empty editable text box that invites typing, below a
  "Template: Auto" dropdown and "Enhance".
- Chat on a fresh note: "This note has no transcript yet." followed by five suggestion buttons
  that cannot work, a "Clear chat" button with nothing to clear, and "Redo enhanced notes" /
  "Redo notes" for notes that were never written.
- Today & upcoming: "No upcoming meetings. Add a calendar in Settings." — text, no link.
- People/Companies: an explanatory paragraph in data-model language ("Directory details come
  only from your notes. Recent topics use your selected AI provider when requested.") with
  "Search directory" and "Sort directory" for an empty list.
- Voice typing history: "No dictations found." under an unlabelled search box.
- Connect other AI tools: "No recent access".
- Trash: nothing.

**Where.** `App.tsx:688-693`, `:335-355`, `:599-685`; `Transcript.tsx:32-50`; `Chat.tsx:128-130`,
`:275-289`; `Calendar.tsx:284`; `People.tsx:136-150`; `Dictation.tsx:258-272`;
`McpSettings.tsx:63`.

**Why it hurts.** An empty state is the first-run experience of every feature. Showing tools
without content makes a new user think something failed to load — which matches the owner's
report of recording with "no transcript ever appeared": the column looked exactly the same
before, during and after.

**Proposed change.** Rule: when there is no content, hide the tools for that content and show
one sentence plus, where possible, the one action that creates content. Exact copy:

| Place | Heading | Body | Action |
|---|---|---|---|
| Main area, no notes yet | Ready for your first meeting | Start a note, press Record, and TalkKeeper writes down what is said. You can type your own notes at the same time. | Primary: **New note** |
| Main area, notes exist, none open | Pick a note on the left | Or start a new one. | Secondary: **New note** |
| Sidebar note list, no notes | — | Your notes will appear here. | — |
| Sidebar, search with no matches | — | No notes mention "garden". | Quiet: **Clear search** |
| Transcript, never recorded | No transcript yet | Press **Start recording** and what is said will appear here as you go. | — (search, copy and delete controls hidden) |
| Transcript, recording, nothing heard for 10 s | Listening… | Words appear a few seconds after they are spoken. | — |
| Transcript, recording stopped, still working | Finishing the transcript… | This can take a minute after a long meeting. | — |
| Transcript, recording finished with no words | Nothing was heard | TalkKeeper recorded for 4 minutes but did not pick up any speech. Check that the right microphone is chosen and try again. | Secondary: **Check microphone** (opens Settings > Recording) |
| Summary, not written, transcript or notes exist | No summary yet | TalkKeeper can turn the transcript and your notes into a tidy summary. | Primary: **Write summary** |
| Summary, not written, nothing to summarise | No summary yet | Record the meeting or type some notes first. | — |
| Ask about this meeting (chat), no transcript and no notes | — | Once this note has a transcript or some notes, you can ask questions about it here. | — (suggestions, Clear and message box hidden) |
| Today, no calendar connected | See your meetings here | Connect a calendar and TalkKeeper will list today's meetings so you can start notes in one click. | Primary: **Connect a calendar** (opens Settings > Calendar) |
| Today, calendar connected, nothing scheduled | Nothing scheduled | No meetings today or in the next 7 days. | — |
| People, empty | No people yet | People appear here when you add them to a note's "Who was there" line. | — |
| Companies, empty | No companies yet | Companies appear here when you add a company to a person. | — |
| Ask your notes, no notes | Nothing to ask about yet | Once you have a few notes, ask questions across all of them here. | Secondary: **New note** |
| Trash, empty | Trash is empty | Notes you delete stay here until you delete them forever. | — |
| Folders, none | — | Group notes into folders. | Quiet icon: **New folder** |
| Voice typing history, empty | — | Nothing yet. Text you speak with voice typing will be listed here. | — |
| Other AI apps, no access | — | No other app has read your notes. | — |

Empty-state headings use `--text` (not muted); body uses `--muted`. Centre the block in the
available area, max width 420px.

"Redo enhanced notes" appears only after a summary exists (as "Write it again", finding 5).
"Clear chat" appears only when the chat has messages.

**Done when.** A new note shows no transcript search box, no copy/delete transcript buttons, no
chat suggestions, no "Redo" section; each empty area shows the text above; the first-run main
area contains a primary "New note" button; the Today empty state's button opens Settings on the
Calendar section.

**Severity.** Must-fix (main area, transcript, summary, chat); should-fix (the rest).

---

### 10. Errors: one generic banner, raw technical text, no next step

**Problem.** Every failure in the app is converted with `String(e)` and shown in a single
peach-coloured strip at the top of the content column with a "Dismiss" button
(`App.tsx:62`, `:365-370`). Consequences:
- The text is whatever the backend produced, including the `Error: ` prefix
  (`04-setup-failed`: "Error: Check your connection and retry.") and internal messages such as
  "Source note is unavailable" (`App.tsx:412`), "dictation retention too large", "Executable not
  found. Replace the clearly marked placeholder below with the full installed path."
- A new error replaces the previous one; there is no heading, no icon, and the strip is not near
  the control that failed. If the user has scrolled down a long note they never see it.
- The same `role="alert"` style is used for a question that is not an error: "There has been a
  long silence. Stop recording?" (`App.tsx:578-592`).
- Setup's error stays on screen inside the setup card while the global banner may show a second
  copy from `setup://error` (`App.tsx:118`).
- Wording is terse and imperative ("Obtain participant consent before recording.", "Prefer
  HTTPS.", "Clipboard unavailable.").

**Where.** `App.tsx:62`, `:118`, `:365-370`, `:578-592`; `Setup.tsx` error line;
`CopyTranscript.tsx` status; `Calendar.tsx` HTTP alert; `McpSettings.tsx:55`; `Chat.tsx:195-212`
("Retry", "Repair local AI setup", "Open Settings").

**Why it hurts.** "Error:" plus a fragment tells a non-technical user that something broke and
that it may be their fault, without saying what still works or what to press.

**Proposed change.**
- **Message shape** for every user-facing problem: a plain heading saying what happened, one
  sentence on what it means or what was kept, and one button for the most likely fix. Never the
  word "Error", never "failed to", never an exception string. Keep the technical text behind a
  quiet "Details" disclosure with a "Copy details" button, for support.
- **Placement.** Problems appear beside what failed: recording problems in the recording panel,
  summary problems in the Summary area, a bad calendar link under that field, setup problems in
  the setup card. Keep the top banner only for problems with no home, and make it stack (newest
  first, max 3) rather than replace.
- **Three levels, three looks** (colours in section 4):
  - *Problem* (red tint, `role="alert"`): something did not work.
  - *Heads-up* (amber tint, `role="status"`): something needs attention or a decision.
  - *Info / done* (green tint or plain, `role="status"`): confirmation.
- **A small lookup** from known backend error kinds to copy, with a default. Engineering: add a
  `describe(error)` function in one file that returns `{ title, body, action? }`; everything
  unknown falls to the default.

| Situation | Heading | Body | Button(s) |
|---|---|---|---|
| Default / unknown | Something went wrong | TalkKeeper could not finish that. Your notes are safe. Try again; if it keeps happening, restart TalkKeeper. | **Try again** · quiet "Details" |
| No internet during setup | Can't reach the internet | Setup needs to download a few files. Check your connection, then carry on — downloads continue where they stopped. | **Carry on with setup** |
| Not enough disk space | Not enough free space | TalkKeeper needs about 7 GB and this computer has 3 GB free. Free up some space, then try again. | **Check again** |
| Microphone blocked | TalkKeeper can't hear you | Your computer is not letting TalkKeeper use the microphone. Turn it on in your system settings, then come back. | **Open microphone settings** |
| Microphone silent | No sound from your microphone | TalkKeeper is recording but hears nothing. Check that the right microphone is chosen and not muted. | **Choose microphone** |
| Summary could not be written | The summary could not be written | The part of TalkKeeper that writes summaries is not responding. Your transcript and notes are safe. | **Try again** · **Fix it for me** (re-runs setup check) |
| Calendar link rejected | That link did not work | TalkKeeper could not read a calendar from it. Copy the private calendar link again and paste the whole address. | — (shown under the field) |
| Calendar link is http | This link is not private in transit | Addresses starting with "http://" can be read by others on your network. Use the "https://" version if your calendar offers one. | — |
| Clipboard blocked | Could not copy automatically | Select the text below and copy it yourself. | **Select all** |
| Note for a source no longer exists | That note has been deleted | The answer referred to a note that is no longer here. | — |
| Helper program for other AI apps missing | The helper program is not installed | Other AI apps need a small helper program to read your notes. | **Show me how** |
| Long silence (heads-up, not alert) | Still in the meeting? | Nothing has been said for a while. | **Stop recording** · **Keep recording** |
| Setup status could not be checked | TalkKeeper could not check its setup | Close and reopen TalkKeeper. If you see this again, run setup again. | **Run setup** |

- **Tone rules.** Say what happened in the user's terms; say what is safe; offer one action;
  no blame ("You entered an invalid…" → "That link did not work"); no exclamation marks; no
  apologies longer than one word.
- **Confirmations of destructive actions** name the thing and the consequence, and the button
  repeats the verb: "Delete "Weekly catch-up" forever? / The note, its transcript and its screen
  pictures will be removed from this computer. This cannot be undone. / **Delete forever** ·
  **Cancel**".
- **Move to trash** needs no confirmation but shows a status toast with undo: "Moved to Trash."
  **Undo**.

**Done when.** No visible string begins with "Error:"; an unknown failure shows the default
message with a working "Details" disclosure; a failure while writing the summary appears in the
Summary area, not at the top of the page; the long-silence prompt is amber and `role="status"`;
two failures in a row are both visible.

**Severity.** Must-fix (shape, placement of recording/summary errors, removal of raw strings);
should-fix (full lookup table).

---

### 11. The note header is a cramped row of mismatched controls and mystery fields

**Problem.** On one line: the title (borderless, looks like a heading), a tiny "stopped" chip,
"Copy transcript" with "Copy options" hanging beneath it, an "Export" disclosure, and "Move to
trash". Below that, a full-width empty box labelled "Attendees" with no placeholder or hint about
format, then "File in: Unfiled". "Copy transcript / Copy options" appears a second time in the
Transcript column 300px lower. Export choices mix levels: "Copy summary as Markdown", "Export
Markdown", "Export transcript", "Export CSV" (the CSV exports all notes, not this one —
`App.tsx:202`).

**Where.** `App.tsx:445-537`; `09-note-view`.

**Why it hurts.** The header's job is "what is this note and is it recording". It currently
leads with export plumbing, and the destructive action is the rightmost, most reachable button.

**Proposed change.**
- Row 1: title (shows a 1px `--border-strong` underline on hover and the focus ring on focus,
  placeholder "Untitled meeting"); status chip (see table in section 6 for the words); a single
  quiet **More** menu button (`aria-label="More actions for this note"`) containing: "Copy
  summary", "Copy transcript", "Save as a file…" (sub-choices: "Notes and summary", "Transcript"),
  a divider, "Move to Trash" in danger text.
- Row 2, one quiet line of metadata: "15 Nov 2026 · 10:02" · **Who was there** (inline field,
  placeholder "Add people, e.g. Sam, Priya") · **Folder** (select; first option "No folder").
- Remove "Copy transcript" from the header; it lives in the Transcript column only, and only when
  a transcript exists. "Copy options" become two checkboxes inside the More menu's copy dialog:
  "Include times", "Include speaker names".
- Move "Export CSV" (all notes) to Settings > Privacy and storage as **Save a list of all notes
  as a spreadsheet file (.csv)**.
- "Manage templates" moves out of the note into Settings > Advanced? No — keep it with the
  summary but behind the summary style menu: last item "Edit styles…". (See section 6 for
  "Template" → "Summary style".)

**Done when.** The note header shows title, one status chip and one More button; "Move to trash"
is not directly clickable from the header row; the attendees field has a visible example; copy
transcript appears once.

**Severity.** Should-fix.

---

### 12. Privacy statements are scattered, technical and sometimes alarming

**Problem.** Privacy is the product's main promise, but it is stated in six different places and
voices: "TalkKeeper runs AI on your computer so your meetings stay private." (Setup); "Local AI:
this conversation stays on your machine." (Chat); "Cloud providers send notes or audio to the
endpoint you select. Local processing uses Ollama and a downloaded speech model." (Settings);
"Speech is processed locally. Styled text goes to your Ollama endpoint: http://localhost:11434."
(Voice typing); "Audio stays in memory and is discarded."; and a bold "Privacy warning: a cloud
assistant may send anything it reads to its provider…" as the very first thing in Settings.

**Where.** `Setup.tsx`, `Chat.tsx:129`, `Settings.tsx:49-52`, `Dictation.tsx:66-80`,
`McpSettings.tsx:44-45`, `Calendar.tsx:247-250`.

**Why it hurts.** A reader cannot tell from "Styled text goes to your Ollama endpoint:
http://localhost:11434" whether anything left their computer. Mixed messages undermine the one
claim that should be simple.

**Proposed change.** One reusable status line component with exactly two states, used wherever
processing location matters (Settings > Privacy and storage, the chat panel, voice typing, the
summary area):
- Private (lock icon, green text): **Everything stays on this computer.**
- Online (globe icon, amber text): **Uses an online service you chose.** followed by a quiet
  link "What is sent?" that opens Settings > Privacy and storage, which lists in plain words
  what goes out: "Summaries and questions: your notes and transcript are sent to *{service
  name}*." / "Turning speech into text: your audio is sent to *{service address}*."

Delete the other phrasings. The "other AI apps" warning becomes, inside Advanced only: "Other AI
apps on this computer can read your notes while this is on. Whatever they read may be sent to the
company that makes that app. Only turn this on for apps you trust."

**Done when.** Exactly two privacy sentences exist in the app for processing location, and each
screen that processes content shows one of them; no user-visible string contains
"localhost" outside Advanced.

**Severity.** Should-fix.

---

### 13. Screen density: the note page stacks eight tools in one scroll

**Problem.** One note page contains, top to bottom: calendar link, header, attendees, folder,
consent line and four recording buttons, screen snapshot gallery, notes editor with six
formatting buttons, template selector and Enhance, Manage templates, a Summary text box *and* a
rendered Summary beneath it, the Transcript column, Chat with five suggestion buttons and a
checkbox, and "Redo enhanced notes" with "Extra instructions". The page is ~1,650px tall when
empty (`09-note-view`). Formatting buttons are text labels in 0.75rem; suggestion chips are full
buttons touching each other.

**Where.** `App.tsx:442-686`; `style.css:130-134`, `:146-157`.

**Why it hurts.** A person in a meeting needs two things: a place to type and a way to see it is
recording. Everything else is after-the-meeting work and should not compete during it.

**Proposed change.** (Layout detail for recording belongs to the recording review; the
clarity-side rules are:)
- Three tabs under the note header, in this order: **Notes** (the editor, plus the summary once
  written, shown above the user's own notes under the heading "Summary"), **Transcript**, **Ask**
  (the chat; label "Ask about this meeting"). While recording on a wide window (≥1100px), Notes
  and Transcript sit side by side as today and Ask stays a tab. Tabs are a real tablist
  (`role="tablist"`, arrow keys move, `aria-selected`).
- The summary has one representation: rendered text with an **Edit** quiet button that swaps in
  the text box, not both at once.
- Summary controls collapse to one row above the summary: primary **Write summary** (before) or
  quiet **Write it again** (after), and a quiet menu **Style: Automatic**. "Extra instructions"
  appears only after pressing "Write it again", labelled "Anything to change? (optional)" with
  placeholder "e.g. shorter, or focus on decisions".
- Formatting toolbar: quiet icon-sized buttons (**B**, *I*, H, bullet list, numbered list,
  checklist) each with `aria-label` ("Bold" etc.) and `title`; use `aria-pressed` for active
  state.
- Suggestion chips: quiet pill buttons with 8px gaps; reword "Add a section about X" (a template
  leaking a placeholder) to "Add a section about…", which puts "Add a section about " in the
  message box and focuses it.
- "Propose a notes revision" → checkbox "Let TalkKeeper edit my notes (you approve changes
  first)".

**Done when.** A new, empty note fits in an 860px-tall window without scrolling; the summary is
shown once; no button label contains a literal "X" placeholder.

**Severity.** Should-fix.

---

### 14. Smaller wording and consistency defects

| # | Where | Now | Change to |
|---|---|---|---|
| a | `Setup.tsx` heading | "Make room for the conversation" | "Set up TalkKeeper" (the current heading reads as a disk-space warning) |
| b | `Setup.tsx` | "Use my own AI provider instead" | Quiet link: "I already have my own AI service (advanced)" |
| c | `Setup.tsx` | "8 GB memory · 20.0 GB storage available" | "This computer has enough room (20 GB free; 7 GB needed)." Show memory only if it is a problem. |
| d | `Setup.tsx` stage labels | "AI engine", "Starting AI", "AI model", "Speech model", "Final check" | "Step 1 of 4: Downloading the note writer", "Step 2 of 4: Downloading speech recognition", "Step 3 of 4: Starting up", "Step 4 of 4: Checking everything works" |
| e | `App.tsx:387` | "Checking setup…" | "Getting ready…" |
| f | `App.tsx:120-123` | "Model download: 100%" (never clears) | "Downloading speech recognition… 64%" then remove on completion |
| g | `App.tsx:539`, `Calendar.tsx:362` | "Obtain participant consent before recording." / "Before capturing, notify participants and ask for their consent." | One sentence everywhere: "Tell everyone you are recording and make sure they agree." with quiet button "Copy a message to send them" |
| h | `App.tsx:573` | "Copy notice" | "Copy message" |
| i | `Calendar.tsx:316` | "Start notes" / "Open linked note" | "Start notes" / "Open notes" |
| j | `Calendar.tsx:302` | "Happening now" | "Now" |
| k | `Calendar.tsx:426` | "Dismiss reminder" | "Not now" |
| l | `Dictation.tsx:407` | "Finish" / "Cancel (Esc)" | "Done" / "Cancel" with `aria-keyshortcuts="Escape"` and a quiet "Esc" hint |
| m | `Dictation.tsx` | "Confirm dictation alongside meeting capture" | "Use voice typing while recording" |
| n | `Templates.tsx` | "Cancel template", "Delete {name}" | "Cancel", "Delete" (with `aria-label="Delete style {name}"`) |
| o | `Snapshots.tsx:180`, `:308` | "Cancel snapshots", "Keep images local" | "Cancel", "Keep pictures on this computer" |
| p | `People.tsx` | "Search directory", "Sort directory", "Recent topics · AI-generated", "Generate recent topics", "Cancel merge" | "Search people", "Sort by", "What you talked about recently (written by AI)", "Show recent topics", "Cancel" |
| q | `WorkspaceChat.tsx` | "Scope", "Scope chips", "Recipes", "Save recipe", "Run recipe", "Workspace chat" | "Which notes?", (remove label), "Saved questions", "Save this question", "Ask again", "Question" |
| r | `WorkspaceChat.tsx` scope options | "Saved selected notes", "Selected notes", "A folder", "Date range" | "The notes I chose before", "Notes I choose", "One folder", "Between two dates" |
| s | `Chat.tsx` | "Chat", "Clear chat", "Message", "Proposed revision", "Version history" | "Ask about this meeting", "Clear", "Your question", "Suggested changes", "Earlier versions" |
| t | `Chat.tsx:209` | "Repair local AI setup" | "Fix it for me" |
| u | Dates | `11/15/2026`, `2026-11-12T10:00:00Z` | Locale long format without year for this year ("15 November"), relative for today/yesterday; times as "10:02" |
| v | `Transcript.tsx` | "Find in transcript", "Delete selected", "Select segment 3" | "Search this transcript", "Delete selected lines", "Select line at 1:05" |

**Severity.** Should-fix (a–h); later (the rest).

---

## 3. Proposed flow (clarity view of a first session)

1. **First launch.** Window shows the sidebar (TalkKeeper; **New note** disabled with "Available
   when setup finishes."; Search notes; Notes; Today; Ask your notes; Folders; Trash; Settings)
   and a centred card: heading "Set up TalkKeeper", body "TalkKeeper writes your meeting notes on
   this computer, so nothing you say leaves it. It needs to download about 7 GB once.", primary
   button **Set up TalkKeeper**, quiet link "I already have my own AI service (advanced)". No
   strip above the app.
2. **Setup running.** One progress bar: "Step 1 of 4: Downloading the note writer · 2.1 of 6.8
   GB · about 9 minutes left". Secondary **Pause setup**. Below: "You can leave this window
   open and do other things."
3. **Setup done.** Heading "TalkKeeper is ready", body "Everything stays on this computer.",
   primary **New note**. The sidebar's New note becomes active (filled accent).
4. **User presses New note.** A note opens. Header: "Untitled meeting" (focused, selected for
   typing), chip "Not recorded", **More**. Metadata line: date, "Who was there", "Folder". The
   recording panel shows the consent sentence "Tell everyone you are recording and make sure
   they agree." and one primary button **Start recording**. Tabs: **Notes** (selected),
   Transcript, Ask. The notes editor has placeholder text "Type your own notes here. TalkKeeper
   will combine them with what is said."
5. **User presses Start recording.** The button reads "Starting…" for a moment. A red bar
   appears across the top: "● Recording · 0:03 · Untitled meeting  [Pause] [Stop recording]".
   The chip turns red: "● Recording". The Transcript area says "Listening… Words appear a few
   seconds after they are spoken." A small level indicator reads "Hearing you". Screen reader
   hears "Recording started".
6. **During the meeting.** The user types in Notes; transcript lines appear on the right (wide
   window) or under the Transcript tab. If they open Settings or another note, the red bar stays.
7. **User presses Stop recording.** Bar disappears. Chip: "Finishing transcript…" then
   "Recorded · 24 min". The Summary area at the top of Notes shows "No summary yet — TalkKeeper
   can turn the transcript and your notes into a tidy summary." with primary **Write summary**.
8. **User presses Write summary.** Button reads "Writing…"; text streams in under the heading
   "Summary". When finished, quiet buttons **Edit**, **Copy**, **Write it again**, and the menu
   "Style: Automatic". Status line beneath: lock icon, "Everything stays on this computer."
9. **User opens Settings.** Focus moves to the heading "Settings". The left list shows
   Recording (selected), Calendar, Voice typing, Privacy and storage, Advanced. The first field
   is "Microphone". Nothing technical is visible. They change "Language spoken in your meetings"
   to "Spanish"; the footer activates; they press **Save changes**; the footer says "Saved".
   They press "Back to notes".
10. **Something fails later** (for example, the summary). A red-tinted panel appears in the
    Summary area: "The summary could not be written — The part of TalkKeeper that writes
    summaries is not responding. Your transcript and notes are safe." with **Try again** and
    **Fix it for me**.

## 4. Visual system (plain CSS)

Small on purpose: one accent, three button styles, one spacing scale, three status colours.
Replace the top of `style.css` with these tokens and migrate rules to them. All pairs listed
meet WCAG AA; ratios in brackets.

### 4.1 Tokens

```css
:root {
  /* type */
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px; line-height: 1.5;
  --fs-sm: 0.85rem;  /* hints, metadata */
  --fs-md: 1rem;     /* body, controls */
  --fs-lg: 1.2rem;   /* section headings (h2) */
  --fs-xl: 1.6rem;   /* view title (h1) */

  /* spacing: 4px scale. Use only these. */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;
  --radius: 8px; --radius-pill: 999px;

  /* surfaces and text */
  --bg: #f5f6f3;            /* window */
  --surface: #ffffff;       /* panels, inputs, sidebar */
  --surface-sunken: #eceee9;/* disabled, wells */
  --text: #26332e;
  --muted: #55635a;         /* hints  [5.83 on bg, 6.33 on white] */
  --border: #d7dfd8;        /* dividers only */
  --border-strong: #7d8a81; /* control outlines [3.61 on white, 3.32 on bg] */

  /* the one accent */
  --accent: #1f5f49;        /* primary fill, links [white text 7.52; on bg 6.94] */
  --accent-hover: #174a39;
  --accent-tint: #e3efe8;   /* selected rows, chips [accent text on tint 6.37] */
  --on-accent: #ffffff;

  /* status */
  --danger: #b3261e;        /* recording, destructive [white text 6.54; on bg 6.03] */
  --danger-hover: #8f1e18;
  --danger-tint: #fbe9e7;   --danger-text: #7a1c16;  /* [8.93] */
  --warn-tint: #fdf1d7;     --warn-text: #5c3d00;    /* [8.83] */
  --ok-tint: #e3efe8;       --ok-text: #14402f;      /* [9.85] */

  --focus: #1c4fd6;         /* focus ring only; never used for anything else [6.17 on bg] */
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #18211d; --surface: #202c25; --surface-sunken: #1b2520;
    --text: #e0e8e1;          /* [11.6 on surface] */
    --muted: #a3b5a7;         /* [6.71 on surface] */
    --border: #3b4b40; --border-strong: #6f8375; /* [3.58 on surface] */
    --accent: #8fd3b0; --accent-hover: #a6dfc1; --accent-tint: #2a4436;
    --on-accent: #10231b;     /* [9.48 on accent] */
    --danger: #ffb4ab; --danger-hover: #ffc9c2; --danger-tint: #4a2622; --danger-text: #ffdad5;
    --warn-tint: #453410; --warn-text: #ffe2a6;
    --ok-tint: #2a4436; --ok-text: #c5ead6;
    --focus: #9ab8ff;         /* [8.38 on bg] */
  }
}
```

In dark mode filled danger buttons use `color: #3a1512` on `--danger` [9.54].

### 4.2 Buttons

Base: `min-height: 36px; padding: 0 var(--s4); border-radius: var(--radius); font-weight: 500;
border: 1px solid transparent; display: inline-flex; align-items: center; gap: var(--s2);`

| Class | Use | Rest | Hover | Notes |
|---|---|---|---|---|
| `.btn-primary` | The one main action in a region | `background: var(--accent); color: var(--on-accent)` | `background: var(--accent-hover)` | Max one visible per region |
| `.btn` (secondary, the default `button`) | Ordinary actions | `background: var(--surface); color: var(--text); border-color: var(--border-strong)` | `background: var(--surface-sunken)` | |
| `.btn-quiet` | Low-emphasis: toolbar, chips, menu triggers, Dismiss | `background: transparent; color: var(--text); padding: 0 var(--s2)` | `background: var(--surface-sunken)` | Chips add `border-radius: var(--radius-pill); border-color: var(--border)` |
| `.btn-danger` | Stop recording; confirm delete | `background: var(--danger); color: #fff` | `background: var(--danger-hover)` | Only in the recording bar/panel and confirm dialogs |
| `.btn-quiet.danger` | "Move to Trash", "Delete folder…" in menus | `color: var(--danger)` | `background: var(--danger-tint)` | |
| any `:disabled` | | `background: var(--surface-sunken); color: var(--muted); border: 1px dashed var(--border-strong); opacity: 1; cursor: not-allowed` | none | Pair with a visible reason |
| `[aria-pressed="true"]` | Toggled formatting button | `background: var(--accent-tint); color: var(--accent)` | | |

Selected (not hover): `.is-current, [aria-current]` → `background: var(--accent-tint); color:
var(--accent); font-weight: 600; box-shadow: inset 3px 0 0 var(--accent);`

Button groups: `gap: var(--s2)`; primary first (left), then secondary, then quiet. In dialogs the
confirming action is leftmost and the cancel is quiet.

### 4.3 Fields

- Label above field: `color: var(--text); font-size: 0.9rem; font-weight: 500; margin-bottom:
  var(--s1)`. Hint below field: `.hint { color: var(--muted); font-size: var(--fs-sm);
  margin-top: var(--s1) }`, linked with `aria-describedby`.
- Input/select/textarea: `min-height: 36px; padding: var(--s2) var(--s3); border: 1px solid
  var(--border-strong); border-radius: var(--radius); background: var(--surface)`.
- Field block spacing: `margin-bottom: var(--s4)`. Section spacing: `margin-top: var(--s6)`.
- Text fields in Settings have `max-width: 28rem`; the Settings column is `max-width: 40rem`.
- Field in error: `border-color: var(--danger); border-width: 2px` plus a message beneath in
  `--danger-text` with `role="alert"`, and `aria-invalid="true"`.

### 4.4 Layout

- Sidebar: `width: 250px; padding: var(--s4); gap: var(--s1)`. Nav row: `height: 34px; padding:
  0 var(--s3); border-radius: var(--radius); display: flex; align-items: center; gap: var(--s3);
  text-align: left; border: 0; background: transparent`. Group label: `font-size: 0.72rem;
  letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: var(--s5) 0
  var(--s1) var(--s3)`.
- Content column: `padding: var(--s6)`; reading width for note text `max-width: 46rem`.
- Recording bar: `height: 44px; padding: 0 var(--s4); background: var(--danger-tint); color:
  var(--danger-text); border-bottom: 1px solid var(--danger); display: flex; align-items:
  center; gap: var(--s3)`. Paused: `--warn-tint` / `--warn-text`.
- Status chip (`.pill`): `padding: 2px var(--s3); border-radius: var(--radius-pill); font-size:
  var(--fs-sm); font-weight: 500;` neutral = `--surface-sunken`/`--muted`; recording =
  `--danger-tint`/`--danger-text` with an 8px dot; working = `--warn-tint`/`--warn-text`; done =
  `--ok-tint`/`--ok-text`.
- Message panels (`.msg`): `padding: var(--s3) var(--s4); border-radius: var(--radius);
  border-left: 4px solid; display: grid; gap: var(--s2)`; `.msg-problem` = danger tint/text and
  border `--danger`; `.msg-headsup` = warn tint/text, border `#b07a00`; `.msg-ok` = ok tint/text,
  border `--accent`. Heading inside is `font-weight: 600`.
- Icons: 16px inline SVG, `stroke: currentColor; stroke-width: 1.75; fill: none`, always
  `aria-hidden="true"` next to text; icon-only buttons require `aria-label` and `title`.
- Focus: `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px }` (finding 8).

### 4.5 Colour meaning (never mixed)

| Colour | Means | Used for |
|---|---|---|
| Accent green | "Do this" / "you are here" | Primary button, current nav row, links, toggles on |
| Red | Recording is on; something will be deleted; something failed | Recording bar, Stop recording, delete confirms, problem panels |
| Amber | Paused; needs your attention; uses an online service | Paused bar, heads-up panels, online privacy line |
| Blue | Keyboard focus only | Focus ring |
| Grey | Everything else | Secondary and quiet controls, hints |

## 5. Settings outline (exact section names and labels)

Page heading: **Settings**. Top-left quiet link: **Back to notes**. Left list: Recording ·
Calendar · Voice typing · Privacy and storage · Advanced. Sticky footer: **Save changes**
(primary) · **Discard changes** (quiet) · status text "Saved".

### Recording

| Label | Control | Hint / notes |
|---|---|---|
| Microphone | Select: "System default", then each device name | "The microphone TalkKeeper listens to." If the build has no picker yet, show read-only text "Using your computer's default microphone." |
| (button) **Test microphone** | Secondary button | Shows a level bar for 5 seconds and one of: "Hearing you clearly." / "No sound from your microphone." |
| (note, Mac microphone-only builds) | Heads-up panel | "This version records your microphone only. Other people on a call are picked up through your speakers, so do not use headphones." |
| Language spoken in your meetings | Select: "Detect automatically" (value `auto`), English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Japanese, Chinese, Korean, Hindi, Arabic, "Another language…" | "Another language…" reveals a text field "Language code" with hint "Two letters, for example sv for Swedish." |
| Names and unusual words | Textarea, placeholder "Priya, Okonkwo, Q3 roadmap" | "Words TalkKeeper should spell correctly. Separate them with commas." |
| Message to ask for permission | Textarea (current "Participant notice" text) | "You can copy this from any note and send it to the people you are meeting." |
| Take pictures of my screen during meetings | Select: "Ask me each time", "Always", "Never" | "Useful for slides. Pictures may show private information." When "Always": "TalkKeeper will use the window in front on your main screen, after you confirm once." |

### Calendar

Intro line: "Connect a calendar to see today's meetings and start notes in one click. TalkKeeper
only reads your calendar; it never changes it."

| Label | Control | Hint / notes |
|---|---|---|
| **Your calendars** (sub-heading) | List of connected calendars: colour dot, name, "Updated 10:02", quiet buttons "Refresh", "Remove…" | Empty: "No calendar connected yet." Remove confirm: "Remove "Work"? / Its meetings will disappear from Today. Notes you already made are kept. / **Remove calendar** · **Cancel**" |
| **Add a calendar** (sub-heading) | | |
| Private calendar link | Text field (masked, with a "Show" toggle button) | "Paste the private link from your calendar app." + disclosure "Where do I find this?" (existing instructions, reworded in steps) |
| Name | Text field, placeholder "Work" | |
| Colour | Colour swatch | |
| (buttons) | **Add calendar** (secondary; tests the link first) · quiet **Choose a calendar file instead…** | Replaces "Test link", "Add calendar", "Import .ics file" |
| My email address | Email field | "Optional. Lets TalkKeeper hide meetings you declined." |
| Remind me when a meeting is about to start | Checkbox | "Only while TalkKeeper is open." |
| Use meeting details when writing summaries | Checkbox | "Adds the meeting's title, time and guest names to your summaries." (+ when an online service is used: "These details are sent to your online service.") |
| Start recording automatically when a meeting begins | Checkbox, **off** | Heads-up panel when ticked: "Only turn this on if everyone in your meetings has already agreed to be recorded. The red recording bar is always shown." |

### Voice typing

Intro line: "Press a shortcut, speak, and TalkKeeper types what you said into any app."

| Label | Control | Hint / notes |
|---|---|---|
| Keyboard shortcut | Shortcut recorder showing key caps (e.g. `Ctrl` `Shift` `Space`, or `⌘` `Shift` `Space` on Mac) | "Click, then press the keys you want." Never display "CommandOrControl". |
| How the shortcut works | Radio: "Press once to start, again to stop" / "Hold down while speaking" | |
| Tidy up what I say | Select: "Type exactly what I say", "Clean up", "Make it formal", "Turn into bullet points" | "Anything other than "exactly what I say" uses AI and takes a moment longer." |
| Extra instructions for tidying up | Textarea (only when not "exactly") | Placeholder "Optional" |
| Play a sound when starting and stopping | Checkbox | |
| Words to replace | Rows of "When I say" → "Type this" with quiet "Remove"; button **Add a word** | |
| (button) **Try voice typing** | Secondary | |
| (button) **Check it can work** | Quiet (was "Check permissions") | Results in plain words: "Microphone: allowed", "Typing into other apps: allowed / needs permission — **Open system settings**" |
| **What you have said** (sub-heading, collapsed disclosure) | Search field labelled "Search what you have said"; list; quiet danger **Delete all** | Empty: "Nothing yet. Text you speak with voice typing will be listed here." |

### Privacy and storage

| Label | Control | Hint / notes |
|---|---|---|
| (status line) | Lock icon + "Everything stays on this computer." or globe icon + "Uses an online service you chose." | When online: bulleted plain list of what is sent and where; quiet link "Change this in Advanced". |
| Keep transcripts for | Select: 30 days, 90 days, 1 year, Forever | "After this, the word-for-word transcript is deleted. Your notes and summaries are always kept." |
| Keep screen pictures for | Select: 30 days, 90 days, 1 year, Forever | "After this, pictures taken of your screen during a meeting are deleted." |
| Keep voice typing history for | Select: Don't keep, 7 days, 30 days, 1 year | "A list of what you said with voice typing." |
| (button) **Save a list of all notes as a spreadsheet file (.csv)** | Secondary | Moved from the note's Export menu. |

### Advanced

Opening line (always visible): "Most people never need these. TalkKeeper chooses sensible
settings during setup." Three collapsed disclosures, closed by default, each a `<details>` with
an `h2`-level summary.

**▸ AI that writes your summaries**

| Label | Control | Hint / notes |
|---|---|---|
| Where summaries are written | Radio: "On this computer (recommended)" (provider `Automatic`) / "An AI program I run myself" (`Ollama`) / "An online AI service" (reveals the next field) | Under the online choice: "Your notes and transcripts will be sent to this service." |
| Service | Select: Anthropic, OpenAI, "Another compatible service" (`OpenAICompatible`) | Only for "An online AI service" |
| Service address | Text field (was "Base URL") | Shown only for "An AI program I run myself" and "Another compatible service". Hint: "For example http://localhost:11434". |
| Secret key | Password field + **Save key** + quiet danger **Remove key** | Shown only for online services. Hint: "From your account with the service. Stored in your computer's password manager, not in TalkKeeper's files." After saving: field shows "A key is saved." |
| AI model | Select + quiet button **Refresh list** (was "Load models") | Empty state: "Press Refresh list to see what is available." |

**▸ Turning speech into text**

| Label | Control | Hint / notes |
|---|---|---|
| Where speech is turned into text | Radio: "On this computer (recommended)" (`local`) / "An online service" (`cloud`) | Online: "Your audio will be sent to this service." |
| Accuracy | Select of downloaded/available speech models, shown as "Faster (78 MB)", "Balanced (466 MB)", "Most accurate (1.5 GB)" with the technical name in the option's `title`; button **Download** when the chosen one is not on disk | Local only. Was "Speech model" + "Download speech model". |
| Service address | Text field (was "STT endpoint") | Online only |
| Model name | Text field | Online only |
| Secret key | Password field + **Save key** + quiet danger **Remove key** (was "Store speech key"/"Clear speech key") | Online only |

**▸ Let other AI apps read your notes**

| Label | Control | Hint / notes |
|---|---|---|
| (warning text) | Heads-up panel | "Other AI apps on this computer can read your notes while this is on. Whatever they read may be sent to the company that makes that app. Only turn this on for apps you trust." |
| Let other AI apps read my notes | Checkbox ("Applies straight away") | |
| Also let them read transcripts | Checkbox, indented, disabled until the first is on | |
| Also let them read my calendar | Checkbox, indented, disabled until the first is on | |
| (hint) | Text | "Notes in Trash, screen pictures, voice typing history and saved keys are never shared." |
| **Set up an app** (nested disclosure) | Existing configuration blocks with copy buttons; **Test the connection** | This is the only place the terms "MCP", "stdio", "PowerShell" and file paths may appear. |
| **Which apps have read your notes** | List: "12 Nov, 10:00 — searched your notes"; quiet **Refresh**, quiet danger **Clear list** | Translate tool names: `search_notes` → "searched your notes", `get_note` → "read a note", `list_notes` → "listed your notes"; unknown → the raw name. Empty: "No other app has read your notes." |

Footer of Advanced: quiet button **Run setup again** (re-opens the setup check; replaces "Repair
local AI setup" as the single repair entry point).

## 6. Jargon replacement table

"Advanced only" means the original technical term may appear as secondary text inside Settings >
Advanced, never elsewhere.

| Now | Where | Replace with |
|---|---|---|
| Start capture | `App.tsx:544` | **Start recording** |
| Stop / Stop capture | `App.tsx:562`, `:221` | **Stop recording** |
| Pause / Resume (both always shown) | `App.tsx:550`, `:556` | One button that swaps: **Pause** ↔ **Resume** |
| Capture recording / Capture paused | `App.tsx:221` | "● Recording · 12:04" / "Paused · 12:04" |
| Capture indicator (aria) | `App.tsx:221` | "Recording" |
| stopped (chip, never recorded) | `App.tsx:453` | "Not recorded" |
| stopped (chip, after a recording) | same | "Recorded · 24 min" |
| recording / paused (chip) | same | "● Recording" / "Paused" |
| · another note | `App.tsx:455` | "Recording a different note" (link to it) |
| Capture shared screen | `Snapshots.tsx:110` | **Take pictures of my screen** |
| Screen snapshots on · 6 snapshots | `Snapshots.tsx:115` | "Taking screen pictures · 6 so far" |
| Stop snapshots | `Snapshots.tsx` | **Stop taking pictures** |
| Screen snapshots (heading, setting) | `Snapshots.tsx:269`, `Settings.tsx:212` | "Screen pictures" / "Take pictures of my screen during meetings" |
| Frontmost window on main display | `Snapshots.tsx:145` | "The window in front" |
| Choose screen source | `Snapshots.tsx:130` | "Which window or screen?" |
| Snapshot retention days | `Settings.tsx:218` | "Keep screen pictures for" |
| Transcript retention days | `Settings.tsx:220` | "Keep transcripts for" |
| Dictation history retention days (0 disables history) | `Dictation.tsx` | "Keep voice typing history for" (option "Don't keep") |
| Enhance | `App.tsx:633` | **Write summary** |
| Enhancing… | `App.tsx:630` | "Writing…" |
| Use Redo notes below (disabled button) | `App.tsx:632` | Remove; show **Write it again** next to the summary |
| Redo enhanced notes / Redo notes | `Chat.tsx:276-289` | **Write it again** |
| Extra instructions | `Chat.tsx` | "Anything to change? (optional)" |
| AI enhancement | `Calendar.tsx:248` | "summaries" |
| Template / Template: Auto | `App.tsx:613` | "Summary style" / "Style: Automatic" |
| Manage templates / Create template / Custom template | `Templates.tsx` | "Edit styles…" / "New style" / "My style" |
| Section headings (one per line) / Instructions | `Templates.tsx` | "Headings to use (one per line)" / "Anything else the summary should do" |
| Your notes (heading) / Rough notes (aria) | `App.tsx:601`, `Editor.tsx:35` | "Your notes" for both |
| Summary / Edit summary | `App.tsx:645-647` | "Summary" with an **Edit** button |
| Untitled conversation | backend default title | "Untitled meeting" |
| Search conversations | `App.tsx:247` | "Search notes" |
| Today & upcoming (nav) | `App.tsx:228` | "Today" (page heading "Today and upcoming") |
| Attendees | `People.tsx` | "Who was there" |
| File in / Unfiled | `App.tsx:525`, `:530` | "Folder" / "No folder" |
| All folders | `App.tsx:280` | "All notes" |
| Move to trash / Permanently delete | `App.tsx:490-498` | "Move to Trash" / "Delete forever" |
| Export / Export Markdown / Copy summary as Markdown / Export CSV | `App.tsx:460-465` | "Save as a file…" / "Notes and summary" / "Copy summary" / "Save a list of all notes as a spreadsheet file (.csv)" |
| With timestamps / Text only | `CopyTranscript.tsx` | Checkbox "Include times" |
| segment | `Transcript.tsx`, `Summary.tsx` | "line" ("This line has been deleted.") |
| Participant notice / Copy notice | `Settings.tsx:230`, `App.tsx:573` | "Message to ask for permission" / "Copy message" |
| Obtain participant consent before recording. | `App.tsx:539` | "Tell everyone you are recording and make sure they agree." |
| Model download: 100% | `App.tsx:122` | "Downloading speech recognition… 64%" (removed when done) |
| AI provider (Advanced) | `Settings.tsx:54` | "Where summaries are written" (Advanced only) |
| Automatic / Ollama / OpenAICompatible (options) | `Settings.tsx:63` | "On this computer (recommended)" / "An AI program I run myself" / "Another compatible service" |
| Base URL | `Settings.tsx:69` | "Service address" (Advanced only) |
| AI API key / STT API key | `Settings.tsx:76`, `:168` | "Secret key" (Advanced only) |
| Store key in keychain / Store speech key | `Settings.tsx:92`, `:183` | **Save key** — hint "Stored in your computer's password manager." |
| Clear key / Clear speech key | `Settings.tsx:96`, `:187` | **Remove key** |
| Load models | `Settings.tsx:99` | **Refresh list** |
| AI model / Choose a model | `Settings.tsx:102` | "AI model" / "Choose one" (Advanced only) |
| Speech engine | `Settings.tsx:120` | "Where speech is turned into text" |
| Local whisper.cpp | `Settings.tsx:125` | "On this computer (recommended)" |
| Cloud compatible STT | `Settings.tsx:126` | "An online service" |
| Speech model / Download speech model | `Settings.tsx:130`, `:158` | "Accuracy" (Faster / Balanced / Most accurate) / **Download** |
| STT endpoint | `Settings.tsx:161` | "Service address" (Advanced only) |
| STT (anywhere) | — | "speech to text" in sentences; never abbreviated |
| Language: `auto` | `Settings.tsx:190` | "Language spoken in your meetings: Detect automatically" |
| Vocabulary (comma separated) | `Settings.tsx:197` | "Names and unusual words" |
| Cloud providers send notes or audio to the endpoint you select. Local processing uses Ollama and a downloaded speech model. | `Settings.tsx:49-52` | "Everything stays on this computer." / "Uses an online service you chose." |
| Local AI: this conversation stays on your machine. | `Chat.tsx:129` | "Everything stays on this computer." |
| provider / cloud provider | several | "online service" |
| endpoint | several | "service address" (Advanced only) |
| local / locally | several | "on this computer" |
| local AI engine, AI engine, runtime | `Setup.tsx` | "the note writer" (first mention: "the AI that writes your notes") |
| Connect other AI tools | `McpSettings.tsx:42` | "Let other AI apps read your notes" |
| MCP / MCP executable / Test MCP connection | `McpSettings.tsx` | "helper program" / **Test the connection** (Advanced only) |
| stdio clients, PATH, executable | `McpSettings.tsx:52-58` | Only inside "Set up an app"; lead with "Follow the steps for your app:" |
| Recent access / `search_notes` | `McpSettings.tsx:60-63` | "Which apps have read your notes" / "searched your notes" |
| credentials | `McpSettings.tsx:50` | "saved keys" |
| keychain / operating system keychain | `Settings.tsx:92`, `Calendar.tsx` | "your computer's password manager" |
| ICS / iCal / .ics file | `Calendar.tsx` | "private calendar link" / "calendar file" |
| Test link / Import .ics file | `Calendar.tsx` | (folded into **Add calendar**) / "Choose a calendar file instead…" |
| Start capture automatically when a meeting begins | `Calendar.tsx:227` | "Start recording automatically when a meeting begins" |
| Use calendar details when writing notes | `Calendar.tsx:240` | "Use meeting details when writing summaries" |
| Dictation (all labels) | `Dictation.tsx` | "Voice typing" |
| Dictation hotkey / `CommandOrControl+Shift+Space` | `Dictation.tsx` | "Keyboard shortcut" shown as key caps |
| Talk mode / Press to start / press to stop / Hold to talk | `Dictation.tsx:109-112` | "How the shortcut works" / "Press once to start, again to stop" / "Hold down while speaking" |
| Dictation style / As spoken / Clean / Formal / Bullet points | `Dictation.tsx:121` | "Tidy up what I say" / "Type exactly what I say" / "Clean up" / "Make it formal" / "Turn into bullet points" |
| Start and stop cues | `Dictation.tsx` | "Play a sound when starting and stopping" |
| Dictionary replacements / Spoken phrase / Replacement | `Dictation.tsx:152-167` | "Words to replace" / "When I say" / "Type this" |
| Check permissions | `Dictation.tsx` | "Check it can work" |
| Dictation history / No dictations found. | `Dictation.tsx:258-272` | "What you have said" / "Nothing yet." |
| Preparing… / Writing… (voice typing) | `Dictation.tsx:391-395` | "Getting ready…" / "Typing…" |
| Ask your notes: Scope / Recipes / Workspace chat | `WorkspaceChat.tsx` | "Which notes?" / "Saved questions" / "Question" |
| Propose a notes revision / Proposed revision | `Chat.tsx:243`, `:160` | "Let TalkKeeper edit my notes (you approve changes first)" / "Suggested changes" |
| Version history | `Chat.tsx:258` | "Earlier versions" |
| Directory / Search directory / Sort directory | `People.tsx:136-146` | "People" / "Search people" / "Sort by" |
| Error: … | everywhere via `String(e)` | Heading + sentence + action (finding 10) |
| Checking setup… | `App.tsx:387` | "Getting ready…" |
| Make room for the conversation | `Setup.tsx` | "Set up TalkKeeper" |
| Use my own AI provider instead | `Setup.tsx` | "I already have my own AI service (advanced)" |
| Compact conversation AI (2.7 GB) | `Setup.tsx` plan text | Not shown in the main sentence; available under "What gets downloaded?" |

## 7. Suggested order of work

1. CSS-only, low risk, large effect: tokens, three button styles, focus ring, border contrast,
   checkbox rule (findings 2, 6, 8 first bullets).
2. String-only: the recording and summary words, status chip words, retention labels and
   options (findings 1, 5).
3. Sidebar restructure and removal of the top strip (findings 3, 7).
4. Settings regrouping with single save (finding 4).
5. Empty states and error component (findings 9, 10).
6. Note header, tabs and remaining wording (findings 11–14).
