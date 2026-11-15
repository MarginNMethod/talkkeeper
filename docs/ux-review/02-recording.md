# UX review 02: the note view and recording

Scope: creating a note, starting/pausing/stopping a recording, knowing it works, the transcript
area, the consent reminder, status wording, the top "Capture recording" bar, what lingers after
stopping, and the overall layout of the note view.

Sources read: `apps/desktop/src/App.tsx`, `Transcript.tsx`, `Snapshots.tsx`, `Chat.tsx`,
`CopyTranscript.tsx`, `style.css`, `apps/desktop/src-tauri/src/session.rs`, the error enums in
`crates/audio/src/lib.rs` and `crates/transcribe/src/lib.rs`, and screenshots 07 to 11.
Nothing was run; everything below is from reading code and screenshots.

Vocabulary used in the proposals: the user-facing word is always **record / recording**. The words
"capture", "STT", "model", "engine", "segment" and "enhance" never appear in the interface.

---

## 1. Verdict

The note view gives the user no trustworthy evidence that a recording is working. There is no
timer, the level meter only appears if audio frames happen to arrive, the transcript column is
blank whether things are fine or broken, and the only "status" is a small grey pill with a raw
internal word. That is exactly how the owner got "it looked live but nothing was transcribed".
When something does go wrong, the message is a raw developer string ("Download the selected model
first", "STT events unavailable") in a banner at the very top of a page that is two screens tall,
with no button to fix it. The primary action is buried: four same-weight buttons labelled with the
word "capture" sit below the title, attendees and filing fields, while a second, unstyled
"Capture recording / Stop capture" strip and an always-present "Capture shared screen" strip
compete above the whole app. Finally the page is one long stack of nine unrelated tools (people,
folder, record, editor, template, summary, chat, redo), so a first-time user cannot tell what to do
first or what to do after stopping.

---

## 2. Findings

### F1. Nothing proves the recording is working, and nothing says when it is not

**Problem.** After clicking "Start capture" the visible changes are: the pill text changes from
"stopped" to "recording", three buttons change which are greyed, and a grey strip appears at the top
of the window. There is no elapsed time. Level meters only appear when the first audio frame
arrives, so with a dead or blocked microphone there is simply no meter rather than a warning. The
transcript column stays blank. The app never compares "is sound arriving" with "are words
arriving", so a silent microphone, a stalled speech engine and a healthy recording during a quiet
moment all look identical.

**Where.** `App.tsx:452-457` (pill), `App.tsx:564-569` (meters rendered only for sources that have
emitted), `Transcript.tsx:47-75` (no empty or live state), `session.rs:193-207` (levels emitted
only per frame; no health events). Screenshot `10-note-recording`.

**Why it hurts.** A recording tool has one job the user cannot retry: the meeting only happens
once. People look for three signs of life, in this order: a running clock, a meter that moves when
they speak, and their own words appearing. None is reliably present, so the user finds out after
the meeting that nothing was captured.

**Proposed change.** Add a "record bar" (see F2 for placement) that always shows three live
indicators while recording, and run four automatic health checks whose results appear inside that
bar within seconds.

Live indicators (left to right, after the button):

| Indicator | Spec |
|---|---|
| Red dot | 10 px circle, `#c0392b`, pulses (opacity 1 to 0.35, 1.2 s) while recording; solid grey when paused; no animation under `prefers-reduced-motion`. |
| Timer | `m:ss`, then `h:mm:ss` after one hour; `font-variant-numeric: tabular-nums`. Counts recorded time only (frozen while paused). When continuing an earlier recording in the same note it restarts at `0:00` for this take. |
| Level | Five vertical bars per source, filled according to level. Map **-60 dBFS = 0 bars, -12 dBFS and above = 5 bars** (the current `<meter min=-100 max=0>` shows ordinary room hiss as 40 to 50 % full, which looks like a working microphone). Label the sources **"Microphone"** and **"Computer sound"**, not "Me" / "Them". Render the Microphone meter from the moment recording starts, empty, even before any frame arrives. Decay: hold peak 150 ms then fall, so it reads as movement rather than flicker. |
| Status sentence | One plain sentence, see the table in F3. |

Health checks (all evaluated in the UI from events that already exist, plus one new event for
"behind"):

| Check | Trigger | What appears |
|---|---|---|
| A. No sound at all | No `capture://level` event for the microphone, or every level at or below -60 dBFS, for the first **8 seconds** of recording (and again whenever 20 s pass with nothing above -60 while not paused) | Warning W1 (F4) |
| B. Sound but no words | Microphone level above -40 dBFS for a cumulative 20 s and no `transcript://segment` received in the last **45 s** | Warning W2 (F4) |
| C. Behind | Speech engine backlog above 15 s (new event from engineering, e.g. `capture://lag {seconds}`) | Notice W3 (F4) |
| D. Long silence | Existing `capture://auto-stop-suggested` | Prompt W4 (F4) |

First words confirmation: the first time a segment arrives in a take, the status sentence changes
from "Listening…" to "Recording. Words are appearing in the transcript." for 5 s, then settles to
"Recording". This is the positive signal the user is waiting for.

**Done when.**
- Starting a recording shows dot, timer at `0:00` and an empty Microphone meter within 500 ms of
  the state changing to recording.
- With the microphone muted at OS level, W1 is visible within 10 s of starting, without scrolling.
- With a mock speech engine that never emits segments while levels are at -20 dBFS, W2 appears
  within 50 s.
- Speaking moves the meter; a silent room shows zero or one bar.

**Severity.** must-fix

---

### F2. The primary action is buried and split across four buttons and two bars

**Problem.** Recording controls are a row of four equal buttons ("Start capture", "Pause",
"Resume", "Stop"), three of which are greyed at any time, placed below the title, attendees field
and folder picker. A second control, "Capture recording [Stop capture]", appears as an unstyled
strip above the whole app, and a third strip, "Capture shared screen", is permanently stuck to the
top of the window even when no note is open (screenshots `07` and `08`), where it is a disabled
button that explains nothing. The top strip scrolls away with the page, while the screen-snapshot
strip is sticky and stays: scroll down during a recording and the only thing left on screen is the
snapshot button, with no sign that recording is on. The note page is about 1,600 px tall, so the
Stop button is off-screen while the user is in Chat or Summary.

**Where.** `App.tsx:221` (top `<aside>`), `App.tsx:224` + `Snapshots.tsx:104-111` +
`style.css:301` (sticky snapshot strip), `App.tsx:538-563` (four buttons). Screenshots `07`, `08`,
`09`, `10`.

**Why it hurts.** A first-time user must pick the right button out of four, in a row that does not
look more important than "Bold" or "Clear chat". Greyed buttons that can never be pressed in the
current state are noise. Two different Stop buttons with different labels suggest two different
things are running.

**Proposed change.** One record bar, sticky at the top of the note view, containing one button that
changes state.

Layout of the bar (single row, 56 px tall, `position: sticky; top: 0; z-index: 20`, panel
background, bottom border; lives inside `.workspace` as the first child of the note view):

```
[ ● Record ]   (hint or live indicators)                                   [secondary] [secondary]
```

The record button is the only filled, coloured button on the page: 40 px tall, min-width 132 px,
14 px bold label, icon left of the label. All other buttons keep the existing outline style.

States of the record control (exact labels):

| # | State | Main button | Secondary buttons (right side) | Indicators / status sentence |
|---|---|---|---|---|
| 1 | Ready, note has no transcript | **● Record** (red fill `#c0392b`, white text) | none | "Records your microphone and turns it into a transcript on this computer." (see F7 for the microphone-only variant and F6 for the consent line) |
| 2 | Ready, note already has a transcript | **● Record more** (outline style, red dot) | none | "Recorded 12 min · adds to the transcript below." |
| 3 | Starting (click until backend reports recording) | **Starting…** (disabled, small spinner replaces dot) | **Cancel** | "Getting ready…"; after 3 s: "Loading speech-to-text. The first start can take up to a minute." |
| 4 | Recording | **■ Stop** (dark fill `#26332e`, white text) | **Pause**, **Add screen snapshots** | dot, timer, level, "Listening…" then "Recording" |
| 5 | Paused | **● Resume** (red fill) | **Stop** | grey dot, frozen timer, "Paused. Nothing is being recorded." |
| 6 | Stopping (click on Stop until backend reports stopped) | **Finishing…** (disabled, spinner) | none | "Writing down the last few words…" |
| 7 | Blocked: note is in Trash | **● Record** (disabled) | **Restore note** | "Restore this note to record in it." |
| 8 | Blocked: recording is running in another note | **● Record** (disabled) | **Go to that note**, **Stop it** | "Already recording in "{title}" ({timer})." |
| 9 | Blocked: dictation is on | **● Record** (disabled) | **Stop dictation** | "Dictation is on. Stop it to record a meeting." |
| 10 | Blocked: a problem must be fixed first | **● Record** (enabled; clicking retries) | the recovery action from F4 | the error text from F4 |

Rules:
- Never show a button that cannot be pressed in the current state, except the main button in
  states 3, 6, 7, 8 and 9.
- "Pause" is intentionally small and secondary: pausing is rare and forgetting to resume is a
  classic way to lose a meeting. While paused, the bar background turns pale amber (`#fbf1d9`,
  dark mode `#4a3f22`) so it cannot be mistaken for recording.
- Stop does not ask for confirmation (it is recoverable with "Record more").
- "Add screen snapshots" replaces the permanent "Capture shared screen" strip. It exists only in
  state 4 and 5. When snapshots are on, it reads **"Screen snapshots on · {n}"** with a **Turn
  off** button. Remove the always-visible `SnapshotControls` strip above the app.
- Keyboard: the main button is the first tab stop in the note view; `Ctrl/Cmd+Shift+R` toggles
  Record/Stop (show it in the button's `title`).
- Delete the top `<aside>` at `App.tsx:221` in its current form; its replacement is F9.
- Delete the `.pill` in the header; the bar carries the status.

**Done when.**
- Exactly one filled button is visible in the note view at any time, and its label is one of:
  Record, Record more, Starting…, Stop, Resume, Finishing….
- The words "capture", "Start capture" and "Stop capture" do not appear anywhere in the UI.
- With the page scrolled to the Chat section during a recording, the Stop button, timer and level
  are still visible.
- With no note open, there is no recording or snapshot control on screen.

**Severity.** must-fix

---

### F3. Status is a raw internal word

**Problem.** The pill prints the backend state string verbatim: "stopped", "recording", "paused",
and "recording · another note". The top strip builds the phrase "Capture recording" by gluing
"Capture" to the same word. A brand-new note that has never been recorded says "stopped".

**Where.** `App.tsx:34`, `App.tsx:221`, `App.tsx:452-457`. Screenshots `09`, `10`.

**Why it hurts.** "stopped" on an untouched note reads as "something has stopped working".
"Capture recording" is not a sentence. Neither tells the user what to do.

**Proposed change.** Replace both with the status sentence in the record bar:

| Situation | Status sentence |
|---|---|
| Never recorded | "Records your microphone and turns it into a transcript on this computer." |
| Starting | "Getting ready…" / "Loading speech-to-text. The first start can take up to a minute." |
| Recording, no words yet | "Listening…" |
| Recording, first words arrived (5 s) | "Recording. Words are appearing in the transcript." |
| Recording | "Recording" |
| Paused | "Paused. Nothing is being recorded." |
| Finishing | "Writing down the last few words…" |
| Just stopped (until the user leaves the note) | "Saved. Recorded 12 min 34 s." |
| Has an earlier recording | "Recorded 12 min · adds to the transcript below." |

The sentence element has `role="status"` and `aria-live="polite"`; warnings from F4 use
`role="alert"`.

**Done when.** No lowercase backend state word is rendered anywhere; a new note shows the "Never
recorded" sentence; each state in the table can be reached and shows exactly that text.

**Severity.** must-fix

---

### F4. Errors and warnings are developer strings, far from the control, with no way to fix them

**Problem.** Every failure goes through `fail()` into one banner at the top of the workspace:
the raw Rust string plus a "Dismiss" button. Examples a first-time user can hit in the first
minute: "Download the selected model first", "Choose an STT model in Settings", "STT events
unavailable", "Capture already active", "audio backend: …", "audio frame queue overflow; capture
stopped", "provider failed: …". A later error overwrites an earlier one. The banner is not sticky,
so if the recording dies while the user is typing notes lower down, they do not see it. An
unexpected stop is reported the same way as a minor copy failure. The long-silence prompt uses
`role="alert"` styling inside the capture block and can also be off-screen.

**Where.** `App.tsx:62`, `App.tsx:105-114`, `App.tsx:365-370`, `App.tsx:578-593`;
`session.rs:42,44,55,58,78,248,268,273,276,287,292`; `crates/audio/src/lib.rs:48-50`;
`crates/transcribe/src/lib.rs:58-69`.

**Why it hurts.** The user cannot act on "STT" or "model", does not know where Settings is relevant,
and is given only "Dismiss", which makes the problem invisible without solving it.

**Proposed change.** Recording problems are shown **inside the record bar**, as a second row that
expands under it (so it is sticky too). Each has a heading, one sentence, a primary recovery
button and at most one secondary. They stay until fixed or explicitly closed; they are never
replaced by an unrelated error. Problems that prevent or end a recording use the red alert style;
warnings during a live recording use amber and never stop the recording. The raw technical text is
kept behind a "Details" disclosure for bug reports. Other, non-recording errors keep the existing
banner, but make it sticky under the record bar.

Blocking errors (recording did not start, or ended):

| ID | Cause (current string) | Heading | Body | Buttons |
|---|---|---|---|---|
| E1 | Microphone permission denied (macOS) | **TalkKeeper isn't allowed to use the microphone** | "Turn on TalkKeeper under System Settings › Privacy & Security › Microphone, then come back and press Record." | **Open microphone settings** · Try again |
| E1w | Same, Windows | **TalkKeeper isn't allowed to use the microphone** | "Turn on microphone access for desktop apps under Settings › Privacy & security › Microphone, then press Record." | **Open microphone settings** · Try again |
| E1l | Same or unknown, Linux | **TalkKeeper can't reach the microphone** | "Check that a microphone is connected and that no other app has locked it, then press Record." | **Try again** |
| E2 | No input device (`audio backend: …` with no device) | **No microphone found** | "Plug in or switch on a microphone, then press Record." | **Try again** |
| E3 | `Download the selected model first`, `Choose an STT model in Settings`, `Unknown local model`, `model verification failed` | **Speech-to-text isn't installed yet** | "TalkKeeper needs a one-time download ({size}) before it can turn speech into text. Nothing leaves this computer." | **Download now** · Open Settings |
| E3p | While that download runs (replaces E3) | **Downloading speech-to-text… {percent} %** | "{done} of {total} · about {time} left. You can keep typing notes. Press Record when it finishes." | Cancel download |
| E3d | Download finished | **Speech-to-text is ready** | "Press Record to start." (auto-closes after 6 s; recording is never started automatically, because consent comes first) | none |
| E4 | `Set the transcription endpoint`, `Set the transcription key` | **Your transcription service isn't set up** | "Add its address and key in Settings, or switch back to transcribing on this computer." | **Open Settings** |
| E5 | `provider failed: …`, `model or provider HTTP request failed`, `STT events unavailable`, `session closed` at start | **Speech-to-text couldn't start** | "Try again. If it keeps happening, restart TalkKeeper." | **Try again** · Details |
| E6 | `Capture already active` | (not an error: state 8 in F2) | | |
| E7 | `Stop dictation before starting meeting capture` | (not an error: state 9 in F2) | | |
| E8 | `Restore this note before recording` | (not an error: state 7 in F2) | | |
| E9 | Recording ended on its own for any reason (`capture://state` = stopped with `error`) | **Recording stopped at {timer}** | "Something went wrong and the recording ended early. Everything up to that point is saved in the transcript." | **Record more** · Details |
| E9o | Same, cause is `audio frame queue overflow` (computer could not keep up) | **Recording stopped at {timer}** | "This computer couldn't keep up with speech-to-text. Everything up to that point is saved. Closing other apps or choosing a lighter speech setting will help." | **Record more** · Speech settings |
| E10 | Microphone unplugged mid-recording | **The microphone was disconnected at {timer}** | "Everything up to that point is saved. Reconnect it and press Record more." | **Record more** |

E9, E9o and E10 must also raise an operating-system notification ("TalkKeeper stopped recording")
and play the system alert sound, because the user is usually looking at their meeting window, not
at TalkKeeper.

Warnings while recording continues (amber):

| ID | Trigger (F1) | Heading | Body | Buttons |
|---|---|---|---|---|
| W1 | Check A | **We can't hear anything** | "Your microphone seems to be silent. Check that it isn't muted and that the right one is selected." | **Choose microphone** · Dismiss |
| W2 | Check B | **We can hear you, but no words are appearing** | "Speech-to-text may be stuck. The sound is still being kept. You can wait, or stop and start again." | **Stop and start again** · Keep waiting |
| W3 | Check C | **The transcript is running behind** | "Words are appearing about {n} seconds late because this computer is busy. Nothing is lost; it will catch up." | Dismiss |
| W4 | Check D (existing) | **It's been quiet for 5 minutes** | "Has the meeting ended?" | **Stop recording** · Keep recording |

W1 clears itself as soon as a level above -40 dBFS is seen; W2 clears on the next segment; W3
clears when the backlog drops below 5 s. W4 must also be shown as an OS notification with the same
two actions. Dismissing W1 or W2 hides it for the rest of the take.

Note for W2: the body promises "the sound is still being kept". If the backend does not keep
audio that has not been transcribed, replace that sentence with "Words spoken right now may be
missed." Engineering should confirm which is true before shipping the copy.

**Done when.**
- None of the strings in `session.rs` listed above can reach the screen verbatim (a test maps each
  to its row).
- Every blocking error has a button that either fixes it or takes the user to the place that does.
- Forcing a mid-recording failure while scrolled to the bottom of the note shows E9 without
  scrolling and raises an OS notification.
- Clicking Record with no speech model shows E3; "Download now" shows E3p with a moving percentage;
  on completion E3d appears and the main button is an enabled "Record".

**Severity.** must-fix

---

### F5. The transcript column is blank before, during the first seconds, and after a failed recording

**Problem.** With no segments the column shows a heading, a search box, "Copy transcript", "Copy
options" and a disabled "Delete selected" over empty space. During recording only final segments
are emitted (`session.rs:134`), so there is a silent gap of several seconds, sometimes much more,
before the first line. After a recording that produced no words, the column looks the same as
before it started. Speaker names are "Me" and "Them"; on microphone-only builds every line is
"Me" even when it was someone else's voice through the speakers. Lines are rendered in arrival
order, not time order (screenshot `09` shows 1:30 above 1:05; this may be mock data, but nothing
in `Transcript.tsx` sorts).

**Where.** `Transcript.tsx:29-76`, `App.tsx:86-92`, `session.rs:134-147`. Screenshots `09`, `10`,
`11`.

**Why it hurts.** Blank space is ambiguous: the user cannot tell "not started", "working, be
patient" and "broken" apart. Tools for an empty list (search, copy, delete) add clutter exactly
when the user needs one clear instruction.

**Proposed change.** Give the column explicit states. Hide the search box, Copy and Delete controls
until there is at least one line.

| State | What the column shows |
|---|---|
| Never recorded | Centered, muted: heading **"No transcript yet"**, body "Press Record and everything that's said will be written here as you go." |
| Starting | "Getting ready…" with spinner. |
| Recording, no lines yet | Pulsing dot + **"Listening…"**, body "Words appear a few seconds after they're spoken." |
| Recording, lines present | Lines, and a last row that is always present while recording: pulsing dot + "Listening…". This row is the liveness signal inside the transcript. |
| Paused | Last row becomes a divider: "Paused at 12:34". On resume it stays in the list as "Paused 12:34 to 14:02" (UI only; no need to store it in v1, it can simply disappear on resume). |
| Finishing | Last row: "Writing down the last few words…" |
| Stopped with lines | Lines; search, **Copy transcript** and selection tools visible. A muted footer: "End of recording · 12 min 34 s". |
| Stopped, the take produced zero lines | Amber box: **"No words were picked up"**, body "The recording ran for {duration} but no speech was recognised. Check your microphone, then try again.", button **Record again**. |

Other changes in this column:
- Sort by `start_ms` then `seq`.
- Speaker labels: **"You"** and **"Others"** instead of "Me" / "Them". On builds without computer
  sound, hide the speaker label entirely (it is always the same and sometimes wrong).
- Replace the per-line checkbox that is always visible with a **Select** toggle in the column
  header; checkboxes and "Delete selected" appear only in select mode.
- Auto-scroll: see F8.

**Done when.** Each state in the table renders the stated text; a new note shows no search, copy or
delete controls in the transcript column; a 20-second recording of silence ends with the "No words
were picked up" box.

**Severity.** must-fix

---

### F6. The consent reminder is easy to miss before recording and turns into clutter after

**Problem.** Before recording, consent is one small grey line of imperative legal language:
"Obtain participant consent before recording." After Start, a different block appears under the
buttons: the full consent script and a "Copy notice" button, with no heading saying what it is for.
That block is only fetched after a successful start (`App.tsx:209`), i.e. after the moment it was
needed, and it is never cleared: it stays after Stop and follows the user into every other note
they open.

**Where.** `App.tsx:37`, `App.tsx:209`, `App.tsx:539`, `App.tsx:570-577`; default text
`src-tauri/src/main.rs:322`. Screenshots `09`, `10`.

**Why it hurts.** The moment that matters is the two seconds before pressing Record. A grey line
does not register, and a script that appears after recording has begun is too late. Leftover
legal text in unrelated notes looks like a bug.

**Proposed change.**
1. **Always-visible line** in the record bar, directly under the status sentence in states 1 and 2,
   in normal (not muted) text colour with a small info icon:
   **"Tell everyone before you record."** followed by a link-style button **"Copy a message to
   send them"**. Clicking copies the consent text and changes the link to "Copied" for 2 s. The
   text itself is shown in a tooltip/popover on hover or focus, with an **"Edit wording"** link to
   Settings.
2. **First-time confirmation.** The first time Record is pressed on this computer, show a small
   dialog anchored to the button (not full-screen):
   - Heading: **"Before you record"**
   - Body: "Make sure everyone in the conversation knows it is being recorded and agrees. In many
     places this is required by law."
   - Checkbox (unchecked): "Don't show this again"
   - Buttons: **Start recording** (primary) · **Not yet**
   - Link: "Copy a message to send them"
   The always-visible line in (1) remains regardless of the checkbox, which satisfies the standing
   reminder.
3. **During recording** the consent line is replaced by the live indicators. The copy action moves
   into the bar's overflow as "Copy consent message". Nothing consent-related is added to the page
   body.
4. **After stopping** nothing consent-related remains except line (1) in state 2. Clear `notice`
   state on stop and on note change.

**Done when.** The consent line is visible without scrolling next to the Record button before every
recording; the first Record click on a fresh profile shows the dialog and recording does not begin
until "Start recording" is pressed; after Stop, and after switching notes, no consent script text
is on the page.

**Severity.** should-fix (the first-time dialog and the lingering block; the line itself exists)

---

### F7. Nothing says what is being recorded, and there is no way to choose the microphone

**Problem.** Recording always uses the system default microphone (`mic_device: None`) and, on
builds without computer-sound support, only the microphone. The interface says neither. A user on
a video call with headphones will record only their own half of the conversation and discover it
afterwards.

**Where.** `session.rs:80-83`; no device UI in `App.tsx` or `Settings.tsx`.

**Why it hurts.** "It recorded only me" is, to the user, the same failure as "it recorded nothing".
A wrong default device (a webcam mic, a disconnected headset) is the most common real-world cause
of a silent recording, and W1 in F4 has nowhere to send the user.

**Proposed change.**
- In states 1 and 2 the status sentence names the source. With computer sound available:
  "Records your microphone and your computer's sound." On microphone-only builds:
  **"Records your microphone only. On a call, use your speakers instead of headphones so the
  other people are picked up."**
- Add a small dropdown at the right of the record bar, labelled with the current device:
  **"🎙 MacBook Pro Microphone ▾"** (use an inline SVG, not an emoji, in the build). Menu items:
  the available input devices with a check on the current one, and a live five-bar level next to
  the selected device so the user can test by speaking before recording. Footer item:
  "Sound settings…" opening Settings. The selection is remembered. The dropdown is available in
  states 1, 2 and 10, and from W1's "Choose microphone" button during a recording (changing device
  mid-recording may restart the audio input; show "Switching microphone…" for that moment).
- While idle, the level next to the device name is live only while the dropdown is open, so the app
  never listens without the user asking.

**Done when.** The record bar names what will be recorded before the user presses Record; on a
microphone-only build the headphones hint is shown; the user can pick a different input and see
its level move before recording; the choice persists across restarts.

**Severity.** should-fix (wording: must-fix; picker: should-fix)

---

### F8. Things that linger or misbehave after stopping, and while recording another note

**Problem.** Several pieces of state are set during a recording and never reset:
- Level meters keep their last value forever after Stop (`levels` is never cleared), so the note
  shows a "live" meter with no recording (screenshot `11` description in the brief).
- "Model download: 100%" stays at the top of the workspace permanently once seen
  (`App.tsx:120-124`, `App.tsx:371`).
- The consent script stays (F6). The long-silence prompt stays if the recording ends by itself.
- An error banner from a previous attempt stays after a later successful start.
- All of these are global, so they also appear on other notes.
- The recording state is global but the buttons are rendered per note: open note B while note A is
  recording and B's "Pause" and "Stop" are enabled and act on A's recording (pause/stop ignore the
  note id, `session.rs:242-263`). The only hint is the pill "recording · another note".
- "Move to trash" silently becomes disabled during recording with no explanation.
- On mount the UI assumes "stopped" and never asks the backend (`App.tsx:34`); if the window is
  reloaded during a recording the UI shows Record while the backend is recording, and pressing it
  yields "Capture already active".
- Every new transcript line calls `scrollIntoView` on an element at the bottom of the transcript
  (`Transcript.tsx:25-27`). That scrolls every scrollable ancestor, including the page, so while
  the user types in the notes editor the page can jump every few seconds; it also jumps when a
  note with a transcript is opened.

**Where.** As cited above. Screenshots `10`, `11`.

**Why it hurts.** Leftover live-looking indicators destroy trust in the real ones. Stopping the
wrong note's recording by accident is unrecoverable for a live meeting. The page jumping under the
cursor makes note-taking during a meeting, the core use, unpleasant.

**Proposed change.**
- On transition to stopped: clear `levels`, `notice`, `autoStop`; clear any recording warning
  (W1 to W4); keep a blocking error (E9, E10) until the user acts.
- Clear a previous recording error when a new start succeeds.
- Download progress is shown only inside E3p (F4) and disappears when complete.
- Scope everything in the record bar to the note being viewed. When another note is recording, use
  state 8 from F2 ("Already recording in "{title}" (12:34)." with **Go to that note** and **Stop
  it**). "Stop it" asks for confirmation: **"Stop the recording in "{title}"?"** with **Stop
  recording** · **Keep recording**.
- "Move to trash" stays enabled-looking during recording; clicking it shows "Stop the recording
  before moving this note to the trash." (or, minimally, add that text as the disabled button's
  `title`).
- On mount, ask the backend for the current recording state (new small command returning
  `{note_id, state, elapsed_ms}`) and render accordingly.
- Transcript auto-scroll: scroll only the transcript list container
  (`list.scrollTop = list.scrollHeight`), never the page, and only when the user is already within
  80 px of the bottom of that list. If they have scrolled up, show a small pill at the bottom of
  the column, **"New lines ↓"**, that jumps to the end. Do not auto-scroll on opening a note.

**Done when.** After Stop, no meter, consent script, silence prompt or download percentage is
visible; opening note B during a recording in note A shows no enabled Pause/Stop for A other than
the confirmed "Stop it"; typing in the notes editor during a recording never changes the page
scroll position; reloading the window during a recording comes back showing Stop and a running
timer.

**Severity.** must-fix (cross-note Stop, page-jump, stale meters) / should-fix (rest)

---

### F9. The global "Capture recording" strip is unstyled, not sticky, and duplicates the note controls

**Problem.** An unstyled `<aside>` is inserted above the whole app during recording with the text
"Capture recording" and a "Stop capture" button, pushing the entire layout down 36 px at start and
back up at stop. It scrolls out of view, shows no timer, does not say which note is recording, and
offers no way to get back to that note.

**Where.** `App.tsx:221`. Screenshot `10`.

**Why it hurts.** Its real job, reminding the user that a recording is running when they are
somewhere else in the app (People, Settings, another note, Ask your notes), is the one it does
worst, while on the recording note itself it is a confusing duplicate.

**Proposed change.** Replace it with a "recording elsewhere" strip that is rendered **only when the
recording note's record bar is not on screen**, i.e. whenever the current view is not that note.
Place it as a sticky first row inside `.workspace` (not above the sidebar, so nothing shifts
sideways), 40 px tall, same red dot, and this content:

```
● Recording "Weekly sync" · 12:34                                   [Go to note]  [Stop]
```

When paused: `Paused "Weekly sync" · 12:34` with **Go to note** · **Resume** · **Stop**.
Warnings and errors from F4 appear in this strip too (heading only, plus "Go to note").
Also mark the recording note in the sidebar list with the red dot before its title.

**Done when.** On the recording note, there is exactly one set of recording controls. On any other
view, the strip is visible without scrolling, shows the note title and a running timer, and "Go to
note" opens that note. Starting and stopping a recording does not move the sidebar.

**Severity.** should-fix

---

### F10. The note view is one long stack with no order of importance

**Problem.** Top to bottom the note page currently shows: calendar link, title with status pill,
"Copy transcript" + "Copy options", "Export", "Move to trash", Attendees, "File in", consent line,
four capture buttons, snapshot gallery, a two-column area (formatting toolbar and editor on the
left, with Template, "Enhance", "Manage templates", a raw Summary textarea and a rendered summary
beneath it; transcript on the right), then a full-width Chat block with five suggestion buttons
and a "Propose a notes revision" checkbox, then "Redo enhanced notes" with an "Extra instructions"
field. On a 1280 x 860 window this is roughly two screens. "Copy transcript" appears twice. The
Enhance button, when a summary exists, becomes a disabled button reading "Use Redo notes below".
Chat suggestions are shown (disabled) on an empty note.

**Where.** `App.tsx:443-686`; `Chat.tsx:125-298`. Screenshots `09`, `10`, `11`.

**Why it hurts.** A first-time user sees about 30 controls before doing anything, most of which are
irrelevant until a recording exists. After stopping, the natural next step (get the written-up
notes) is a small outline button labelled with jargon, below the fold of the editor, next to a
"Template" picker they have never heard of.

**Proposed change.** Reorganise into four zones. Nothing is removed; things move behind
disclosures that already fit the stack (`<details>`, a simple tab strip, plain CSS).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ RECORD BAR (sticky)  [● Record]  status / timer / level        mic ▾   ···   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Untitled conversation                                              [ ··· ]   │
│ Today 10:02 · Add people · No folder                                         │
├───────────────────────────────────────────┬──────────────────────────────────┤
│ [ My notes ] [ Written-up notes ]         │ Transcript                       │
│                                           │                                  │
│  editor (fills the height)                │  (states from F5)                │
│                                           │                                  │
├───────────────────────────────────────────┴──────────────────────────────────┤
│ ▸ Ask about this note                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Zone by zone:

1. **Record bar** (F2). Right side: microphone dropdown (F7) and nothing else when idle.

2. **Title block.**
   - Title input, placeholder **"Untitled note"** (do not prefill the literal text "Untitled
     conversation" as a value the user must delete; keep it as the stored fallback title).
   - One muted detail line under it: date and time · people · folder. With no people it reads
     **"Add people"**; with people, "Ana, Ben +2". With no folder, **"No folder"**; otherwise the
     folder name. Clicking either opens the existing Attendees editor or folder select inline,
     right there. This replaces the two always-open full-width fields.
   - One **"···" menu** (label for assistive tech: "More actions") at the right of the title
     containing: Copy transcript · Copy transcript options… · Copy written-up notes · Export as
     Markdown · Export transcript · Export all notes as CSV · Move to trash. This replaces the
     header's Copy transcript, Copy options, Export and Move to trash. (Transcript-specific copy
     stays available in the transcript column header once lines exist.)

3. **Work area**, a two-column grid that fills the remaining window height
   (`height: calc(100vh - record bar - title block - ask bar)`, each column scrolls on its own;
   the page itself no longer scrolls on a normal window).
   - Left column has two tabs: **My notes** (the editor, selected by default) and **Written-up
     notes** (today's "Summary"). The second tab shows a dot when it has content.
   - The formatting toolbar becomes a single compact row of icon buttons with `title` text; it is
     hidden until the editor has focus.
   - Editor placeholder: **"Jot things down while you listen. Rough is fine; TalkKeeper will tidy
     it up with the transcript afterwards."**
   - Right column: Transcript (F5). Below 900 px wide, the transcript becomes a third tab
     ("Transcript") instead of stacking under the editor.
   - Snapshot gallery: shown as a strip at the top of the transcript column only when the note has
     snapshots.

4. **After-recording step** (replaces "Template / Enhance / Use Redo notes below / Redo enhanced
   notes"). When a recording stops and the note has a transcript but no written-up notes, the
   record bar's status sentence reads "Saved. Recorded 12 min 34 s." and a single prominent
   button appears at the top of the left column:
   - **"Write up my notes"** (accent green fill `var(--accent)`), with a muted line beside it:
     "Combines what you typed with the transcript. Takes about a minute."
   - A small link next to it: **"Style: Automatic ▾"** opens the template choice and "Manage
     styles…" (today's "Manage templates"). "Template" is renamed **"Style"** in the UI.
   - While it runs: button reads **"Writing…"**, the view switches to the Written-up notes tab and
     text streams in.
   - When written-up notes exist, the tab's header row has **"Redo"** (opens a small popover:
     field "Anything to change? (optional)", button **"Write again"**) and **"Edit"** (toggles the
     raw text area, which is hidden by default; today both the raw textarea and the rendered view
     are always shown).
   - In this state the record button is state 2, "Record more", in outline style, so the page has
     one obvious next step.

5. **Ask about this note** (today's "Chat"). A collapsed bar pinned to the bottom of the work
   area: **"▸ Ask about this note"**. Hidden entirely until the note has a transcript or notes.
   Expanded, it shows the message field with placeholder "Ask anything about this conversation…",
   the suggestion buttons, and the privacy line ("Stays on this computer." / existing cloud
   wording). "Clear chat" moves into a small "···" in the panel header. The "Propose a notes
   revision" checkbox is removed from view: revisions are already detected from the wording
   (`Chat.tsx:99-103`), and the two suggestion buttons that revise can set it.

**Done when.**
- On a new note at 1280 x 860 the page does not scroll, and the visible controls are: Record, the
  microphone dropdown, title, detail line, "···", two tabs, the editor and the empty transcript
  message.
- Every action available today is still reachable in at most two clicks (checklist: copy
  transcript with options, four exports, trash, attendees, folder, template choice and
  management, raw summary editing, redo with instructions, chat, clear chat, screen snapshots).
- After stopping a first recording, "Write up my notes" is visible without scrolling and is the
  only filled button on the page (Record has become the outline "Record more").
- "Copy transcript" appears once in the page body.

**Severity.** should-fix (the after-recording step and removing the duplicate/always-open fields
are the highest-value parts; the tabbed layout can follow)

---

### F11. Creating a note does not lead to recording

**Problem.** The empty workspace says "A place to collect the conversation / Create a note to
write, record, and find the details that matter." with no button; the user must find "New note",
the third of eight identical outline buttons in the sidebar. After setup the app does create a note
automatically (`App.tsx:390-393`), but it lands on the long stack with "stopped" and "Start
capture". A new note is created with the literal title "Untitled conversation", and every click on
"New note" creates another one, so the list fills with identical untitled entries.

**Where.** `App.tsx:239-244`, `App.tsx:688-693`, `App.tsx:173-178`. Screenshots `07`, `08`.

**Why it hurts.** The goal is "click one button and everything works". Today the minimum is two
buttons with unrelated names in different regions, and the first one does not mention recording.

**Proposed change.**
- Empty workspace: heading **"Ready when you are"**, body "Start a recording now, or open a note
  from the list.", primary button **"● Record a new note"** (same red style as Record) and a
  secondary **"New note without recording"**. The primary creates a note and goes straight to
  state 3 (through the first-time consent dialog of F6 when it applies).
- Sidebar: make "New note" the single filled (accent) button at the top of the sidebar, above
  "Today & upcoming"; the rest stay outline. (Sidebar order beyond that belongs to another
  reviewer.)
- The automatically created first note after setup opens with a one-time callout pointing at the
  Record button: **"You're all set. Press Record when your meeting starts."** (dismissed on first
  click anywhere).
- If the current note is empty (no title change, no notes, no transcript), "New note" reuses it
  instead of creating another.
- When a recording stops and the title was never edited, set the title to
  "Recording, {weekday} {time}" (for example "Recording, Tuesday 10:02") so the list is
  distinguishable; a calendar-linked note keeps the event name.

**Done when.** From the empty workspace, one click starts a recording in a new note (two on the
very first run, counting the consent dialog); pressing "New note" five times in a row leaves one
untitled note in the list.

**Severity.** should-fix

---

### F12. Smaller items

1. **Starting has no feedback.** `capture()` awaits `start_capture`, which loads the speech engine
   before any event is emitted (`session.rs:76-77`); on a slow disk nothing happens for seconds
   and users click again, getting "Capture already active". Covered by state 3 in F2; ensure the
   button enters "Starting…" synchronously on click, and a second click is impossible.
   *Severity: must-fix (engineering already has this).*
2. **Stopping has no feedback.** `run_capture` drains the speech engine after Stop
   (`session.rs:223-224`) before emitting "stopped"; the UI still says recording during that time.
   Covered by state 6; enter it synchronously on click. *Severity: should-fix.*
3. **Closing the window while recording.** Not verified in code. Expected behaviour to specify:
   closing asks **"A recording is in progress. Stop and save it before closing?"** with **Stop and
   close** · **Keep recording**. *Severity: should-fix, needs engineering check.*
4. **Chat privacy line** "Local AI: this conversation stays on your machine." Suggested: "Stays on
   this computer." *Severity: later.*
5. **Trash view of a note** shows the full recording row with a disabled Start and no reason
   (`App.tsx:541`). Covered by state 7. *Severity: later.*
6. **Dark mode colours** for the new bar: red `#e06a5c` on dark for dot and Record fill, amber
   paused background `#4a3f22`, alert background reuses the existing `#573e32`. *Severity: later.*
7. **Accessibility.** The record button's accessible name must match its visible label in every
   state; state changes are announced through the `role="status"` sentence ("Recording started",
   "Recording paused", "Recording stopped and saved"); the level bars are `aria-hidden` with a
   text alternative only in warning W1. Do not rely on red alone: every state has a distinct
   label and icon shape (circle, square, spinner). *Severity: should-fix.*

---

## 3. Proposed flow

First recording, everything working (microphone-only build):

1. Setup finishes. The app opens a new note. The record bar shows a red **● Record** button and
   the text "Records your microphone only. On a call, use your speakers instead of headphones so
   the other people are picked up." Under it: "Tell everyone before you record. Copy a message to
   send them". A callout points at the button: "You're all set. Press Record when your meeting
   starts." The transcript column says "No transcript yet. Press Record and everything that's said
   will be written here as you go."
2. The user clicks **Record**. A small dialog appears on the button: "Before you record. Make sure
   everyone in the conversation knows it is being recorded and agrees. In many places this is
   required by law." They click **Start recording**.
3. The operating system asks for microphone access (first time only). They allow it.
4. The button reads **Starting…** with "Getting ready…", then "Loading speech-to-text. The first
   start can take up to a minute." The transcript column says "Getting ready…".
5. The button turns into a dark **■ Stop**. Beside it: pulsing red dot, `0:00` counting up, the
   Microphone bars moving as they speak, and "Listening…". Smaller buttons **Pause** and **Add
   screen snapshots** sit at the right. The transcript column shows "Listening… Words appear a few
   seconds after they're spoken."
6. A few seconds later the first line appears in the transcript. The status reads "Recording.
   Words are appearing in the transcript." and then just "Recording". The user types rough notes
   in **My notes**; the page never jumps.
7. They click **Stop**. The button reads **Finishing…** with "Writing down the last few words…"
   for a moment.
8. The bar shows "Saved. Recorded 12 min 34 s." and an outline **● Record more** button. Meters and
   timer are gone. At the top of the left column a green **Write up my notes** button appears with
   "Combines what you typed with the transcript. Takes about a minute."
9. They click **Write up my notes**. The button reads **Writing…**, the **Written-up notes** tab
   opens and fills in. Afterwards the tab offers **Redo** and **Edit**, and "▸ Ask about this
   note" is available at the bottom.

When something is wrong, the same flow branches inside the record bar:

- Step 3 denied, or permission previously denied: the bar turns red: "TalkKeeper isn't allowed to
  use the microphone. Turn on TalkKeeper under System Settings › Privacy & Security › Microphone,
  then come back and press Record." **Open microphone settings** · Try again.
- Step 4, speech-to-text missing: "Speech-to-text isn't installed yet. TalkKeeper needs a one-time
  download (1.5 GB) before it can turn speech into text. Nothing leaves this computer."
  **Download now**. Then "Downloading speech-to-text… 42 % · 630 MB of 1.5 GB · about 3 min left.
  You can keep typing notes. Press Record when it finishes." Then "Speech-to-text is ready. Press
  Record to start."
- Step 5, eight seconds with no sound: amber row under the bar: "We can't hear anything. Your
  microphone seems to be silent. Check that it isn't muted and that the right one is selected."
  **Choose microphone** · Dismiss. It disappears by itself the moment sound is heard.
- Step 6, sound but no words for 45 seconds: "We can hear you, but no words are appearing.
  Speech-to-text may be stuck. The sound is still being kept. You can wait, or stop and start
  again." **Stop and start again** · Keep waiting.
- During the meeting, the computer is busy: "The transcript is running behind. Words are appearing
  about 20 seconds late because this computer is busy. Nothing is lost; it will catch up."
- The recording ends by itself: red row, system notification and sound: "Recording stopped at
  31:07. Something went wrong and the recording ended early. Everything up to that point is saved
  in the transcript." **Record more** · Details.
- Five minutes of quiet: "It's been quiet for 5 minutes. Has the meeting ended?" **Stop
  recording** · Keep recording (also as a system notification).
- The user wanders to People or another note mid-meeting: a strip at the top of the workspace
  reads "● Recording "Weekly sync" · 12:34" with **Go to note** · **Stop**.
