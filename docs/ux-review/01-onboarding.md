# UX review 01: Onboarding (first launch to first working note)

Scope: everything between the first launch and the first note that records and transcribes.
Sources read: `apps/desktop/src/Setup.tsx`, `apps/desktop/src/App.tsx` (setup parts),
`apps/desktop/src-tauri/src/setup.rs`, `crates/setup/src/lib.rs`, screenshots 01 to 08.

## 1. Verdict

Setup is built as a gate: the whole app is locked behind a 7 to 30 GB download, even though the
only thing a person needs to record and get a transcript is a 78 MB speech model. Worse, that
small file is downloaded *last* (`crates/setup/src/lib.rs:381-399`, after the multi-gigabyte AI
model), so the wait before anything works is as long as it can possibly be. While waiting, the
user sees one thin unlabelled bar with no total, no amount downloaded and no time left, and the
final step sits at 0% for up to ten minutes. Setup never touches the microphone, so "You're ready"
is declared without checking the one thing recording depends on, which is exactly the failure the
owner hit. The escape hatches (Settings, "Use my own AI provider", Cancel, closing the app) each
lead to a dead end or a lost place rather than a recoverable state.

The fix is a change of model, not polish: **one click starts everything, the app opens
immediately, and features unlock in order as their piece arrives** (typing at once, recording
after about a minute, AI notes when the large model lands). Setup becomes a small persistent
status card instead of a screen.

## 2. Findings

### 1. The whole app is locked until every download finishes

- **Problem:** After clicking "Set up automatically" the user stares at the Setup screen. "New
  note" and "Ask your notes" are greyed out with no explanation, and every other view is replaced
  by Setup. Nothing can be done for the whole download.
- **Where:** `App.tsx:230`, `App.tsx:240` (`disabled={setupNeeded !== false}`), `App.tsx:385-400`
  (Setup replaces the workspace); screenshots `01-setup-first-launch`, `02-setup-running`.
- **Why it hurts:** On a typical home connection 7 GB is 15 to 60 minutes and 30 GB can be hours.
  A first-time user who installed the app five minutes before a meeting cannot use it for that
  meeting. Greyed-out buttons with no reason read as "broken".
- **Proposed change:** Replace the single `setupNeeded` gate with three independent readiness
  flags held in App state and reported by a new `setup_status` shape:
  `{ notes: true, speech: "missing" | "downloading" | "ready" | "failed", ai: "missing" | "downloading" | "checking" | "ready" | "failed" | "custom" }`.
  - Typing notes, folders, search, People, Companies, Trash: always available, from the first
    second, even before the user has clicked anything.
  - Recording and transcript: available when `speech === "ready"`.
  - AI notes, note chat, "Ask your notes": available when `ai` is `ready` or `custom`.
  - "New note" is never disabled. "Ask your notes" stays visible; while AI is not ready, clicking
    it opens the view with this message in place of the input:
    **"Ask your notes will be ready when the AI model finishes downloading (about 12 min left)."**
  - The Setup screen is shown only until the user has made the one choice (finding 3). After that
    the workspace shows the normal app plus the setup card (finding 4).
- **Done when:** With a throttled network, a tester clicks the start button and within 2 seconds
  can create a note and type in it; no sidebar button is disabled at any point in setup.
- **Severity:** must-fix

### 2. The 78 MB speech model is downloaded after the multi-gigabyte AI model

- **Problem:** Download order is: engine, AI model (2.7 to 20+ GB), then speech model (78 MB),
  then a final check. Recording cannot work until the very end.
- **Where:** `crates/setup/src/lib.rs:381-399` (`provision` pulls the AI model first, then calls
  the speech `download`).
- **Why it hurts:** The piece that unlocks the core job (record a meeting, see a transcript) is
  about 1% of the download and currently arrives last. This alone makes "usable right away"
  impossible.
- **Proposed change:** New order: (1) computer check, (2) **speech model**, (3) AI engine,
  (4) AI model, (5) AI check. Emit a new event `setup://unlocked` with payload `"speech"` and later
  `"ai"`; on `"speech"` the backend writes `stt_engine`/`stt_model` preferences immediately (today
  that only happens at the very end, `setup.rs:87-91`) and stores `setup.speech_ready = true`.
  If engineering can run the speech download concurrently with the engine download, do so, but
  simple reordering is enough.
- **Done when:** On a fresh install with a 10 Mbit/s connection, "Record" becomes usable in under
  two minutes after the click, while the AI model progress is still below 5%.
- **Severity:** must-fix

### 3. First screen: too much to read, no primary button, an unclear headline

- **Problem:** The first screen has five paragraphs, a disclosure and two buttons of equal weight.
  The headline "Make room for the conversation" does not say what will happen. The user is asked
  to read a model name ("Compact conversation AI (2.7 GB)"), "the local AI engine", memory and
  storage figures, and an offline note. The two buttons look identical; the technical one
  ("Use my own AI provider instead") sits directly under the main one.
- **Where:** `Setup.tsx:36-49`; screenshot `01-setup-first-launch`.
- **Why it hurts:** A non-technical person cannot tell which button is "the normal one", and the
  memory/storage line invites a decision they are not equipped to make. One decision should look
  like one decision.
- **Proposed change:** A single centred panel (max-width 440px) with exactly this content:

  ```
  Welcome to TalkKeeper

  TalkKeeper listens to your meetings, writes down what was said,
  and turns it into tidy notes. Everything stays on this computer.

  [ Get started ]                         <- primary, filled, autofocus, Enter activates

  Downloads 6.8 GB in the background. You can start taking notes right away.

  I already have my own AI provider       <- small text link, not a button
  ```

  - Add a `.primary` button style in the existing CSS (filled with the green already used for the
    active note in the sidebar, white text); all other buttons stay outlined.
  - The size line uses `plan.total_download_bytes`, one decimal. Remove from this screen: the
    model name, engine wording, memory figure, "About this AI model" and the offline paragraph.
    Move them into a "Details" disclosure on the setup card (finding 4).
  - Storage is only mentioned when it is a problem (finding 9). `plan.notice`, when present, is
    shown as one line under the size line.
  - While `setup_plan` is loading, show the panel with the button disabled and the size line
    reading "Checking your computer…"; do not show a blank panel.
  - Also hide the permanently disabled "Capture shared screen" top bar until a recording is in
    progress; on first launch it is the first thing in the window and it does nothing.
- **Done when:** The first screen has one filled button, at most 40 words of body text, and a
  tester asked "what do you click?" answers in under 3 seconds. Pressing Enter on launch starts
  setup.
- **Severity:** must-fix

### 4. Progress shows no total, no amount, no time left, and stalls at 0% at the end

- **Problem:** During setup the user sees one narrow bar per stage with a tiny label ("AI model")
  and a sentence ("Downloading your AI model"). No percent, no GB, no time left, no overall bar.
  The first-screen paragraphs stay on screen above it. The "Final check" bar sits at 0% for as
  long as ten minutes (`verify_model` has a 600-second timeout) with the text "Checking that your
  AI can answer".
- **Where:** `Setup.tsx:13`, `Setup.tsx:46`; `crates/setup/src/lib.rs:353-355`, `400-407`;
  screenshot `02-setup-running`.
- **Why it hurts:** With a download this big, "how long?" is the only question. Without an answer
  people assume it is stuck and quit, and a bar frozen at 0% for minutes confirms that fear.
- **Proposed change:** A **setup card** pinned at the bottom of the sidebar, directly above
  "Settings", visible in every view (including Settings) until setup is finished and dismissed.
  It is the only place setup progress lives. Layout (sidebar width, about 216px):

  ```
  Setting up TalkKeeper
  [==========------------------]  34%
  2.3 of 6.8 GB · about 12 min left
  ✓ Notes        ready
  ✓ Recording    ready
  ◌ AI notes     downloading
  Pause   Details
  ```

  - One overall bar: `sum(completed bytes) / plan.total_download_bytes`. Stages that report no
    byte totals (check, starting the engine, AI check) are weighted as 0 bytes and do not move
    the bar; the bar is capped at 99% until the AI check passes.
  - Second line, exact formats: `"{done} of {total} GB · about {n} min left"`. Time left = bytes
    remaining / average speed over the last 30 seconds, rounded to: "less than a minute",
    "about N min" (under 60), "about N hr M min" (M rounded to 10). For the first 10 seconds and
    whenever speed is 0, show `"{done} of {total} GB · working out time left…"`.
  - Three checklist rows with these states and exact words:
    - Notes: always `ready`.
    - Recording: `waiting` → `downloading` → `ready` / `needs attention`.
    - AI notes: `waiting` → `downloading` → `almost ready` → `ready` / `needs attention`.
  - The final check never shows a 0% bar. While it runs: bar stays at 99% with an animated
    (indeterminate) stripe, second line reads **"Trying out the AI model. This can take a few
    minutes on some computers."**
  - "Details" opens a small panel listing the five steps with plain names and their own state:
    "Computer check", "Speech model (78 MB)", "AI engine", "AI model: {friendly_name}
    ({n} GB)", "AI check", plus the licence text that today lives under "About this AI model",
    plus the line "Needs the internet once. After that TalkKeeper works offline."
  - The card uses `role="status"` with `aria-live="polite"` for row state changes only (not for
    every percent tick); the bar has `aria-label="Setup progress"`.
  - Backend: add `bytes_done`/`bytes_total` across all stages to the progress event, or let the UI
    sum the per-stage `completed`/`total` it already receives.
- **Done when:** At any moment during setup, in any view, the user can read percent, GB done of
  total and time left without navigating; no bar is ever visible at 0% for more than 5 seconds
  while work is in progress.
- **Severity:** must-fix

### 5. Setup never asks for or tests the microphone, yet says "You're ready"

- **Problem:** Setup ends with "You're ready" without ever touching the microphone. The first
  time the microphone is involved is the first real recording, where the owner saw a "live"
  recording with no transcript and no permission prompt.
- **Where:** `Setup.tsx:36-38` (ready state), no microphone call anywhere in `setup.rs` or
  `crates/setup`; screenshot `06-setup-ready`.
- **Why it hurts:** The first recording is usually a real meeting. Discovering a permission or
  device problem there loses the meeting and the user's trust in one go.
- **Proposed change:** Do **not** put the permission prompt on the welcome screen (an operating
  system prompt before the user has asked to record anything gets refused). Put a short
  **microphone check** at the moment recording unlocks, and make it the thing that confirms
  readiness:
  1. When `speech` becomes `ready`, the setup card row changes to "Recording   ready" and a
     one-time panel appears at the top of the workspace (above the current view, not modal):

     ```
     Recording is ready. Let's check your microphone.
     Say a few words and watch them appear. Takes 10 seconds.
     [ Check my microphone ]   Not now
     ```
  2. Clicking "Check my microphone" triggers the operating system permission prompt (first time
     only). Before it appears, the panel text changes to:
     **"Your computer will ask if TalkKeeper may use the microphone. Choose Allow."**
  3. Once allowed, the panel shows a live level meter, the name of the microphone in use, and a
     box where the words appear:

     ```
     Listening… say "Testing, one, two, three."
     Microphone: MacBook Air Microphone
     [ level meter ]
     "Testing, one, two, three."            <- live transcript
     ```
  4. Outcomes, exact wording:
     - Words appeared: **"Your microphone works. You're ready to record."** with one button
       **"Done"**. Persist `setup.mic_checked = true`.
     - Level moves but no words after 10 seconds: **"We can hear you, but the words aren't
       coming through yet. This can be slow the first time."** Buttons: **"Try again"**, "Skip".
     - No level at all after 5 seconds: **"We can't hear anything. Check that your microphone
       isn't muted and is the one selected in your computer's sound settings."** Buttons:
       **"Try again"**, **"Open sound settings"**, "Skip".
     - Permission refused: **"TalkKeeper isn't allowed to use the microphone. Turn it on in your
       computer's privacy settings, then come back."** Buttons: **"Open privacy settings"**,
       **"Try again"**. (On macOS open the Privacy > Microphone pane; on Windows
       `ms-settings:privacy-microphone`; on Linux show the text only.)
  5. "Not now" / "Skip" collapses the panel; the same check then runs automatically the first
     time the user presses Record, and a "Check my microphone" button is added to Settings.
  6. On builds that record the microphone only, the success state adds one line:
     **"This version records your microphone only, not the other people on a call. Use speakers,
     not headphones, so it can hear them."**
  The test audio is discarded and never creates a note; say so under the meter in small text:
  "This test isn't saved."
- **Done when:** On a fresh install the operating system microphone prompt appears during the
  check (not before the first click, and not silently never); each of the four outcomes can be
  reproduced and shows the wording above; a user who denies permission is offered a button that
  opens the right settings page.
- **Severity:** must-fix

### 6. Opening Settings during setup hides progress and can strand the user

- **Problem:** Clicking "Settings" while downloads run replaces the Setup screen with a 3,500px
  settings page. Progress disappears. Because the Setup component unmounts, its progress listener
  and `busy` state are lost; on returning, the user sees the first screen again with "Set up
  automatically", and clicking it returns the error "Setup is already running".
- **Where:** `App.tsx:372-384` (Settings takes precedence over Setup), `Setup.tsx:26-34` (state
  and listener live inside the component), `setup.rs:47-49`; screenshot
  `03-settings-opened-during-setup`.
- **Why it hurts:** A curious click on the only enabled-looking button during a long wait makes
  the app look like it lost the download.
- **Proposed change:** Move setup state out of `Setup.tsx` into App (or a small `useSetup` hook
  mounted once in App): the `setup://progress` listener is registered at app start and never torn
  down, and the setup card (finding 4) renders from that state in every view. Add a backend
  command `setup_progress` returning the latest progress per stage plus `running: bool`, called
  on mount, so the UI can always rebuild itself. "Setup is already running" must never be shown;
  if `setup_run` is called while running, return Ok and let the UI attach to the existing run.
- **Done when:** Start setup, open Settings, close Settings, switch to Trash and back: the card
  shows continuous, correct progress throughout and no error appears.
- **Severity:** must-fix

### 7. Closing the app or losing the network loses the user's place

- **Problem:** If the app is closed mid-download, the next launch shows the first screen again as
  if nothing had happened; the user must find and click "Set up automatically" again
  (`setup.rs:119-121` only resumes when setup had already completed). If the network drops, setup
  stops with a red box reading "Error: Check your connection and retry." and waits for a manual
  "Retry setup". The red box includes the raw "Error:" prefix. Nothing says whether what was
  already downloaded is kept.
- **Where:** `setup.rs:110-121`, `setup.rs:140-146`; `Setup.tsx:32`, `45`, `47`;
  `crates/setup/src/lib.rs:15-18`; screenshot `04-setup-failed`.
- **Why it hurts:** A 30 GB download will almost certainly span a laptop lid close or a Wi-Fi
  blip. Each one currently needs the user to notice, understand and act, and "retry" sounds like
  starting from zero.
- **Proposed change:**
  - **Auto-resume on launch:** if `setup.pending_plan` exists and setup is not complete and the
    user did not pause (see below), start `setup_run` automatically at launch. The card shows
    **"Picking up where we left off…"** for the first seconds, then normal progress.
  - **Network loss:** do not fail. Retry automatically with backoff (5 s, 15 s, 60 s, then every
    60 s, indefinitely). While waiting the card shows, in the neutral colour (not red):
    **"Waiting for the internet. Your download is saved and will carry on by itself."** with a
    **"Try now"** link. The bar keeps its position.
  - **Closing the window while downloading:** show one confirmation the first time only:

    ```
    Setup isn't finished yet
    If you quit now, the download pauses and carries on next time you open TalkKeeper.
    [ Keep TalkKeeper open ]   Quit anyway
    ```
    with a checkbox "Don't ask again".
  - **Pause instead of Cancel:** rename "Cancel setup" to **"Pause"**. Paused card:
    **"Download paused · 2.3 of 6.8 GB saved"** with **"Resume"**. Persist
    `setup.paused = true` so a paused download does not auto-resume at launch. Delete the
    current cancel message ("Setup cancelled. You can resume by choosing Set up automatically.",
    `lib.rs:33`), which names a button that is not on screen at that moment; a pause is not an
    error and must not be shown in the alert style.
  - Strip the "Error: " prefix everywhere (`String(e)` at `Setup.tsx:20`, `32`, `47`); show the
    message text only.
  - Sleep/wake: treat a stalled connection after wake as network loss (same auto-retry).
- **Done when:** (a) Quit at 30%, relaunch: download continues from about 30% with no click.
  (b) Turn Wi-Fi off for a minute and on again: download continues with no click and no red box.
  (c) Pause, quit, relaunch: card shows "Download paused" with "Resume".
- **Severity:** must-fix

### 8. "Use my own AI provider instead" is a dead end

- **Problem:** The button opens the entire Settings page scrolled to the top ("Connect other AI
  tools"). The provider controls are about 2,300px further down under an unlabelled paragraph.
  Only an in-memory value is changed (`provider: "Ollama"`); nothing is saved, so pressing
  "Close" bounces the user straight back to the Setup screen. The button is also disabled while
  setup is running, which is when someone watching a slow download is most likely to want it.
- **Where:** `App.tsx:394-398`, `App.tsx:372-383`; `Setup.tsx:48`; screenshot
  `05-own-provider-settings`.
- **Why it hurts:** The one person this is for (someone who already runs their own AI) gets a
  wall of unrelated settings and no confirmation that anything worked. Everyone else who clicks
  it by mistake is lost.
- **Proposed change:** A dedicated small panel, not the Settings page. Reached from the "I
  already have my own AI provider" link on the welcome screen and from "Details" on the setup
  card ("Use my own AI provider instead"), enabled at all times.

  ```
  Use your own AI provider
  For people who already run an AI service or have an API key.
  If that's not you, go back and choose Get started.

  Provider        [ Ollama on this computer ▾ ]
  Address         [ http://localhost:11434     ]
  API key         [                            ]   (hidden for local providers)
  [ Test connection ]

  AI model        [ Choose a model ▾ ]             (filled after a successful test)

  ☑ Still download the small speech model (78 MB) so recording works on this computer

  [ Save and continue ]     Back
  ```

  - "Test connection" results, inline under the button:
    success **"Connected. 4 models found."**; failure **"Couldn't reach that address. Check it's
    running and the address is right."**; bad key **"The provider refused that key."**
  - "Save and continue" is disabled until a test has passed and a model is chosen. It saves
    preferences, sets `ai = "custom"`, starts the speech-model download if the box is ticked, and
    cancels any running AI download after confirming:
    **"Stop downloading the built-in AI model? The 2.3 GB already downloaded will be removed."**
    Buttons: **"Stop and remove"**, "Keep downloading".
  - A privacy line appears only when a non-local provider is selected:
    **"Your notes and transcripts will be sent to this provider to write AI notes."**
  - "Back" returns to wherever the user came from with nothing changed.
  - The full provider settings remain in Settings for later edits.
- **Done when:** A user with a local AI service running can go from first launch to an
  AI-ready app in under a minute without scrolling; pressing "Back" never changes any setting;
  after "Save and continue" the app never shows the welcome screen again.
- **Severity:** should-fix

### 9. Failure messages are terse, technical, or point at things that do not exist

- **Problem:** All failures land in the same pink box followed by "Retry setup". Several
  messages refer to "Advanced settings" (there is no such place), "the application drive", "the
  model catalog", "integrity check", or tell the user to "choose a smaller model". A failed
  `setup_status` call leaves "Checking setup…" on screen forever with no button. When there is
  too little storage, the start button is simply disabled (`can_install` false) with no reason
  next to it.
- **Where:** `crates/setup/src/lib.rs:13-43`; `App.tsx:54-56`, `386-387`; `Setup.tsx:45-47`;
  screenshot `04-setup-failed`.
- **Why it hurts:** A failure during setup is the moment a new user decides whether to keep the
  app. Each message must say what happened in plain words, whether their progress is safe, and
  give one obvious next step.
- **Proposed change:** Failures appear on the setup card (and, for the two that block the first
  click, on the welcome panel). Each has a headline, one sentence, and named buttons. Because
  the app is usable regardless, every AI failure also ends with the reassurance line
  **"You can keep recording and taking notes meanwhile."**

  | Cause (`Error::`) | Headline | Body | Buttons |
  |---|---|---|---|
  | `Offline` | Waiting for the internet | Your download is saved and will carry on by itself. | Try now |
  | `Blocked` | Something is blocking the download | A firewall or network filter is stopping TalkKeeper. If you're on a work or school network, try another one. | Try again |
  | `Disk` | Not enough free space | TalkKeeper needs {need} GB free and this computer has {have} GB. Free up {need − have} GB, then try again. | Try again · Use my own AI provider |
  | `Memory` | This computer can't run the built-in AI | It has too little memory. Recording and transcripts still work. For AI notes, connect your own AI provider. | Use my own AI provider · Continue without AI notes |
  | `Runtime` | The AI engine didn't start | Quit other AI apps if any are open, then try again. | Try again |
  | `Checksum`, `Archive` | The download was damaged | We'll fetch that part again. Nothing else is lost. | Download again |
  | `Verify` | The AI model isn't answering | Your computer may be busy. Close some apps, then try again. | Try again · Use my own AI provider |
  | `Speech` | The speech model didn't download | Recording needs this small file (78 MB). | Try again |
  | `Io` | TalkKeeper can't save files | Check there is free space and that you're allowed to save to this computer. | Try again |
  | `Catalog` | This copy of TalkKeeper is damaged | Download and install it again. | (none) |
  | `Unsupported` | The built-in AI isn't available on this computer | Recording and transcripts still work. For AI notes, connect your own AI provider. | Use my own AI provider · Continue without AI notes |

  - `Offline` and `Checksum`/`Archive` retry automatically (finding 7); their buttons are only a
    shortcut.
  - "Continue without AI notes" sets `ai = "skipped"`; the card collapses to one line
    **"AI notes are off · Set up"**, and the AI controls show the locked state from finding 10
    with the text **"AI notes aren't set up on this computer."** and a **"Set up"** link.
  - Disk shortfall is checked before the first click: when `can_install` is false, the welcome
    panel shows the `Disk` row above the (disabled) "Get started" button plus a
    **"Check again"** button that re-runs `setup_plan`.
  - `setup_status` failure: replace the endless "Checking setup…" with, after 5 seconds or on
    rejection: **"TalkKeeper couldn't open its saved settings."** and buttons **"Try again"**
    and **"Start anyway"** (the latter behaves as a fresh install). The `.catch(fail)` at
    `App.tsx:56` runs before `fail` is defined on line 62; make sure the rejection path sets a
    state the UI can render.
  - A collapsed "Technical details" line under any failure shows the original error text for
    bug reports.
- **Done when:** Every `Error` variant maps to a row above; no message contains "Advanced
  settings", "catalog", "integrity" or "Error:"; forcing `setup_status` to reject shows two
  working buttons within 5 seconds.
- **Severity:** must-fix

### 10. Nothing explains what works now and what is still coming

- **Problem:** Today the question never arises because everything is locked. Once the app opens
  during downloads (finding 1), the note view shows recording controls, "Summary", "Chat" and
  "Redo enhanced notes" that would silently fail or throw errors into the top banner.
- **Where:** `App.tsx:445-594` (note view), `App.tsx:536-562` (capture buttons), `App.tsx:626`;
  screenshot `07-first-note-after-setup`.
- **Why it hurts:** A control that looks available but fails teaches the user the app is
  unreliable. A control that is greyed out with no reason teaches the same thing more slowly.
- **Proposed change:** Each locked control states why and when, in place, and unlocks itself
  without a reload.
  - **Record button, speech not ready** (first minute or so): button disabled, with text beside
    it: **"Recording will be ready in about a minute. You can type notes now."** If the speech
    download failed: **"Recording isn't ready. "** + link **"Try again"**.
  - **Record button, speech ready, AI not ready:** fully enabled. Under it, once per note:
    **"You can record now. AI notes will be written when the AI model finishes downloading."**
  - **Transcript column, empty:** **"What's said will appear here while you record."**
  - **AI notes area (Summary / enhance button), AI not ready:** the button is replaced by a quiet
    inline status with a small bar mirroring the card:
    **"AI notes unlock when the download finishes · about 12 min left"**
    Paused: **"AI notes are waiting. The download is paused. "** + link **"Resume"**.
  - **Recording stopped while AI not ready:** the note is queued and says:
    **"Recording saved. AI notes for this meeting will be written automatically when the AI model
    is ready."** When AI becomes ready, queued notes are enhanced in order (oldest first), and
    each shows **"Writing AI notes…"** then the result. Persist the queue (a flag on the note) so
    it survives a restart.
  - **Note chat and "Ask your notes", AI not ready:** input disabled, placeholder
    **"Available when the AI model finishes downloading."**
  - **Sidebar:** no disabled buttons. No lock icons.
- **Done when:** With speech ready and AI at 20%, a tester records a short note, stops, and sees
  the "will be written automatically" line; when the download completes the AI notes appear in
  that note without the tester clicking anything. No AI control produces an error banner while
  AI is not ready.
- **Severity:** must-fix

### 11. "You're ready" proves nothing and pushes the user into a blank, busy note

- **Problem:** The ready screen shows "You're ready", repeats the privacy sentence, and after
  1.5 seconds automatically creates an "Untitled conversation" and navigates there, whether or
  not the user was reading. The button "Create your first note" is redundant with the timer. The
  final progress message "You're ready" also appears under the "Final check" bar. Nothing has
  been demonstrated to work.
- **Where:** `Setup.tsx:21-25`, `36-38`; `App.tsx:390-393`; `crates/setup/src/lib.rs:407`;
  screenshots `06-setup-ready`, `07-first-note-after-setup`.
- **Why it hurts:** A timed auto-navigation takes control away, and screen-reader users may not
  hear the message before the view changes. More importantly "ready" is a claim; the user needs
  proof, which is hearing their own words transcribed (finding 5).
- **Proposed change:** Remove the ready screen and the timer. Readiness is confirmed in two
  honest moments:
  1. **Recording ready:** the microphone check (finding 5) ends with
     **"Your microphone works. You're ready to record."**
  2. **Everything ready:** when the AI check passes, the setup card turns into a completion
     state, and a toast-style line appears once at the top of the workspace:

     ```
     ✓ TalkKeeper is fully set up
     Recording and AI notes both work, and everything stays on this computer.
     [ Start a note ]   Dismiss
     ```
     If the user is mid-recording or typing, show only the card change, never steal focus, never
     navigate. If notes were queued: add **"Writing AI notes for 2 saved meetings now."**
     The card stays in its done state ("✓ All set") until dismissed or the next launch, then is
     removed permanently (`setup.card_dismissed = true`).
  - If the user skipped the microphone check, the completion line instead reads:
    **"AI notes are ready. One thing left: check your microphone."** with
    **"Check my microphone"**.
  - Give the first note a useful starting state: title placeholder "Untitled meeting", cursor in
    the notes box, placeholder text **"Type your notes here. Press Record to capture what's
    said."**
- **Done when:** No view change happens without a click; the completion message appears once,
  only after the AI check passes, and is announced via `role="status"`.
- **Severity:** should-fix

### 12. The consent reminder is missing from the path to the first recording

- **Problem:** The only consent wording a new user meets is a grey line above the capture
  buttons, "Obtain participant consent before recording.", easy to miss on the first busy note.
- **Where:** `App.tsx:~534`; screenshot `07-first-note-after-setup`.
- **Why it hurts:** The legal reminder matters most the first time, when the user has not yet
  formed a habit; a faint line of legalese does not form one.
- **Proposed change:** Keep the inline reminder, reworded: **"Let everyone know you're
  recording."** The first time the user presses Record (ever), show a small one-time panel
  anchored to the button:

  ```
  Before you record
  Tell the people in the meeting that you're recording and taking notes.
  In many places that's the law.
  [ Start recording ]   Cancel
  ☐ Don't remind me again
  ```
  "Don't remind me again" hides the panel on later recordings; the inline line always stays.
  (Detailed recording-view design belongs to the recording review; this note only covers the
  first-run moment.)
- **Done when:** The first Record click on a fresh install shows the panel; with the box ticked
  it never shows again; the inline reminder is present on every note.
- **Severity:** should-fix

### 13. Wording and small layout problems on the setup screens

- **Problem / Where / Proposed change:**
  - "Checking setup…" on every launch flashes before the app appears (`App.tsx:387`). Render the
    normal shell immediately and resolve setup state in the background; show nothing for the
    first 300 ms.
  - "the local AI engine", "Compact conversation AI", "speech model" are internal names
    (`Setup.tsx:40`, `13`). User-facing words: "Recording" (speech) and "AI notes" (engine plus
    model). Internal names appear only under "Details".
  - `plan.hardware.os === "macos" ? "Mac" : "computer"` personalisation is unnecessary once the
    paragraph is removed; delete it.
  - The disclosure "About this AI model" touches the button below it with no spacing
    (screenshot `01-setup-first-launch`); it moves into "Details".
  - The per-stage `<label>` text and bar are on one line at 12px (screenshot
    `02-setup-running`); replaced by the card in finding 4.
  - Progress bars use the browser default blue; style `progress` with the app's green in CSS so
    it matches the rest of the app in all three operating systems.
- **Why it hurts:** Each is small; together they are much of why the screen "seems clunky".
- **Done when:** None of the strings "local AI engine", "Checking setup…", "Final check" or
  "Set up automatically" appear in the first-run UI.
- **Severity:** later

## 3. Proposed flow

Assumes a typical computer (8 GB memory, 6.8 GB download) and a working network.

1. **Launch.** The normal app window opens: sidebar on the left, all buttons enabled. The
   workspace shows the welcome panel:

   > **Welcome to TalkKeeper**
   > TalkKeeper listens to your meetings, writes down what was said, and turns it into tidy
   > notes. Everything stays on this computer.
   > **[ Get started ]**
   > Downloads 6.8 GB in the background. You can start taking notes right away.
   > I already have my own AI provider

2. **User clicks "Get started"** (the one click). Immediately:
   - A new note opens, titled "Untitled meeting", cursor in the notes box, placeholder
     "Type your notes here. Press Record to capture what's said."
   - The setup card appears above "Settings" in the sidebar:
     "Setting up TalkKeeper · 0% · 0.0 of 6.8 GB · working out time left…", rows
     "✓ Notes ready", "◌ Recording downloading", "◌ AI notes waiting", links "Pause", "Details".
   - Beside the disabled Record button: "Recording will be ready in about a minute. You can type
     notes now."

3. **About one minute later** the speech model is in. Card row: "✓ Recording ready". Record
   button enables. A panel slides in above the note:

   > **Recording is ready. Let's check your microphone.**
   > Say a few words and watch them appear. Takes 10 seconds.
   > **[ Check my microphone ]**   Not now

4. **User clicks "Check my microphone."** Panel: "Your computer will ask if TalkKeeper may use
   the microphone. Choose Allow." The operating system prompt appears; the user allows.

5. Panel: "Listening… say "Testing, one, two, three."" with the microphone name, a moving level
   meter, and "This test isn't saved." The user's words appear.

6. Panel: **"Your microphone works. You're ready to record."** **[ Done ]** (On microphone-only
   builds, plus: "This version records your microphone only, not the other people on a call. Use
   speakers, not headphones, so it can hear them.")

7. **User presses Record for the first time.** One-time panel: "Before you record. Tell the
   people in the meeting that you're recording and taking notes. In many places that's the law."
   **[ Start recording ]** Cancel, "Don't remind me again". Recording starts; the transcript
   fills in. Under the Record button: "You can record now. AI notes will be written when the AI
   model finishes downloading."

8. **User stops recording** while the card reads "41% · 2.8 of 6.8 GB · about 9 min left". The
   note shows: "Recording saved. AI notes for this meeting will be written automatically when the
   AI model is ready."

9. **Wi-Fi drops.** Card, neutral colour: "Waiting for the internet. Your download is saved and
   will carry on by itself. Try now". Wi-Fi returns; the bar continues with no click.

10. **User closes the window.** Dialog: "Setup isn't finished yet. If you quit now, the download
    pauses and carries on next time you open TalkKeeper." **[ Keep TalkKeeper open ]** Quit
    anyway. They quit. On next launch the app opens on their notes; card: "Picking up where we
    left off…" then normal progress from 41%.

11. **Download finishes.** Card: bar at 99% with moving stripe, "Trying out the AI model. This
    can take a few minutes on some computers." Row: "◌ AI notes almost ready".

12. **Check passes.** Card: "✓ All set". One line at the top of the workspace:

    > **✓ TalkKeeper is fully set up**
    > Recording and AI notes both work, and everything stays on this computer.
    > Writing AI notes for 1 saved meeting now.
    > **[ Start a note ]**   Dismiss

    The note from step 8 shows "Writing AI notes…" and then its AI notes. The card is gone at the
    next launch.

**Alternative at step 1: "I already have my own AI provider."** Opens the small "Use your own AI
provider" panel (finding 8). The user picks a provider, clicks "Test connection" ("Connected. 4
models found."), chooses a model, leaves "Still download the small speech model (78 MB)" ticked,
clicks **"Save and continue"**. The flow rejoins at step 2 with a 78 MB download and the card row
"✓ AI notes ready (your own provider)"; steps 3 to 7 are unchanged.

**Decision count for the default path:** one (Get started). Required reading before that click:
two sentences. Everything else is either automatic or offered at the moment it becomes relevant.
