# UX review: ranked fix list

This merges the three reviews into one list of work. The detail (exact wording, states, layouts and
"done when" tests) lives in the review it points to:

- `01-onboarding.md`: first launch to first note. Findings are numbered 1–13.
- `02-recording.md`: the note view and recording. Findings are numbered F1–F12.
- `03-clarity.md`: wording, layout, Settings and accessibility. Findings are numbered C1–C14 below,
  which matches its own numbers 1–14, plus §4 visual system, §5 Settings outline and §6 jargon table.

Where reviews overlap, the rule is: recording review wins on the record control, onboarding wins on
setup, clarity wins on words and visual style.

## Goal

One click on first launch. The app is usable at once, recording works within about a minute, and
the app always says plainly what is happening and what to do when something is wrong.

## Must-fix

### Package A: recording that works and tells the truth (in progress, `fix-recording`)
- Microphone permission on macOS (entitlement plus an explicit request), with a clear error and an
  "Open microphone settings" button.
- A slow speech model no longer stops the recording.
- Warnings for a silent microphone and a mic-only build, a "Starting…" state, and real error text.
- Covers parts of F1, F4, F7 and F12a.

### Package B: one-click first run
- **B1.** One "Get started" click. A note opens at once, and downloads run in the background
  (onboarding 1, 3, 10). Three readiness levels:
  - notes always work;
  - recording works once the speech model is in;
  - AI notes work once the AI model is in.

  Meetings recorded early get their AI notes automatically when the AI model arrives.
- **B2.** Download the speech model first, before the AI engine and AI model (onboarding 2).
- **B3.** A setup card in the sidebar, owned by App so Settings can't unmount it (onboarding 4, 6). It shows:
  - one overall bar, for example "2.3 of 6.8 GB · about 12 min left";
  - a three-row checklist;
  - Pause and Details buttons;
  - no 0% bar during the final check.
- **B4.** An unfinished setup resumes on relaunch. A lost network connection retries on its own
  (onboarding 7).
- **B5.** A 10-second microphone check when recording unlocks. It triggers the OS prompt and shows
  the level and live words, and it is what confirms "Ready to record" (onboarding 5, 11).
- **B6.** Plain failure messages with named buttons. Fix the endless "Checking setup…" with
  "Try again" and "Start anyway" (onboarding 9).

### Package C: the note view and the record control
- **C1.** One record button that changes state (F2, F3). States:
  - Record
  - Starting…
  - Stop
  - Resume
  - Finishing…
  - Record more

  Pause is a small secondary button. A recording bar pinned to the top shows a dot, a timer and a
  5-bar level. A strip appears only when you're on a different note from the one recording (F9),
  and the old unstyled top strips are removed (C7).
- **C2.** Automatic health checks inside the record bar (F1), each with exact wording and a fix button:
  - no sound within 8 s;
  - sound but no words within 45 s;
  - running behind;
  - long silence.
- **C3.** Map every backend error string to a plain heading, sentence and fix button, shown in the
  record bar or next to the action that failed. Show no raw strings (F4, C10).
- **C4.** Transcript empty states before, during and after recording (F5, C9).
- **C5.** Fix these bugs (F8):
  - Pause and Stop on note B act on note A while A records.
  - Each new transcript line scrolls the whole page.
  - Meters, the consent text, the silence prompt and "Model download: 100%" follow you into other
    notes.
  - The UI assumes "stopped" on load and never asks the backend.
- **C6.** Say what is being recorded. The mic-only wording is a must-fix (F7). The microphone picker
  is in package E.

### Package D: words, look and Settings
- **D1.** Apply the visual system in clarity §4 (C2, C6, C8):
  - primary, secondary and quiet buttons;
  - one accent colour;
  - visible focus ring and readable borders;
  - the checkbox rule that separates every checkbox from its label.
- **D2.** Rewrite the jargon using the clarity §6 table. "Capture", "Enhance", "STT", "whisper.cpp",
  "provider" and "retention" all get plain replacements (C5).
- **D3.** Build a simpler sidebar from the clarity §3 proposal (C3).
- **D4.** Regroup Settings with everyday options first and the AI and speech settings under
  "Advanced", using a single Save (clarity §5, C4).
- **D5.** Stop silently deleting transcripts after 30 days (C1). The default becomes "Keep forever",
  the label is plain, and the app warns before anything is deleted. **This is a data-loss risk, so
  it ships with package C.**

## Should-fix (after the must-fix packages)
- **E1.** The "Use my own AI provider" path becomes a small panel with "Test connection" and
  "Save and continue" (onboarding 8).
- **E2.** A microphone picker for meetings (F7).
- **E3.** A simpler note layout (F10, C11, C13):
  - four zones;
  - "My notes / Written-up notes" tabs;
  - one "Write up my notes" button that replaces Template, Enhance and Redo;
  - chat collapsed into "Ask about this note".
- **E4.** Consent reminder (F6, onboarding 12). Show it as one line by Record and a first-time
  confirmation, and don't let it linger after stopping.
- **E5.** A new note leads straight to recording, with a "Record a new note" button on the empty
  screen (F11).
- **E6.** Group the privacy statements and make them plain (C12). Fix the remaining smaller wording
  items (C14, F12, onboarding 13).

## Later
- **F12** cosmetic items, the clarity "later" items, and onboarding 13 layout polish.
- **F12c.** Closing the window mid-recording: engineering must first check what happens today.

## Order of work
1. **A** (running now).
2. **B and C** in parallel. They touch different parts of `App.tsx`, so C keeps to the note view and
   B keeps to setup and the sidebar card.
3. **D**, which touches every screen, so it goes after B and C to avoid conflicts. **D5 is the
   exception** and ships with C.
4. **E**, then **Later**.

Every package lands as its own draft PR with tests and green CI on macOS, Windows and Linux.
Nothing merges without the owner's go-ahead.
