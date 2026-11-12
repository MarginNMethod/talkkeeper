# Manual desktop verification

## Voice typing permissions and hardware

These tests need real macOS and Windows hardware; the Linux container cannot
verify native hotkeys, microphone consent, Accessibility, focus, or paste timing.

1. Complete local setup. In Settings → Voice typing, choose Check permissions. It
   lists microphones and guidance; successfully opening capture is the microphone
   permission check. On macOS enable TalkKeeper in System Settings → Privacy &
   Security → Microphone and Accessibility, then restart. On Windows allow
   microphone access for desktop apps in Privacy settings.
2. Focus a text editor outside TalkKeeper. Test Cmd/Ctrl+Shift+Space in toggle and
   hold modes, then a custom hotkey. Verify the always-on-top indicator appears
   before recording, shows levels and Listening/Writing, and does not steal focus.
   Close/hide it while listening: capture must stop. Test Cancel in the indicator and global Esc from the
   other app, including during transcription/cleanup: nothing should be inserted.
3. Test all styles, editable instructions, vocabulary, language and replacement
   rules. Stop Ollama or make it slow: raw text should insert after the cleanup
   timeout. Verify start/stop cues and their off switch.
4. Deny Microphone and verify a readable error. Deny Accessibility: text should
   remain on the clipboard with guidance in the main app. On Windows test an
   elevated target; automatic input may be blocked. Test Linux X11 automatic paste
   and Wayland manual Ctrl+V fallback.
5. Seed the clipboard with text and verify restoration after paste. Change it
   during insertion and ensure the new contents survive. Test restoration of text, HTML, an image, a file list and an empty clipboard.
   Custom application-specific formats cannot be restored. Verify the 350 ms restoration delay works in target apps.
6. Check newest-first history, search, copy, delete, clear, seven-day retention and
   retention zero. Check no dictation audio is saved. Confirm cloud transfer labels
   for cloud speech/AI. With a meeting running, dictation must require explicit
   confirmation and must never stop, pause or modify the meeting.
7. Build the default macOS app with Command Line Tools without Xcode 26. New
   dependencies must not require Swift, apple-metal or ScreenCaptureKit.

Automated tests cover SQLite migration and retention, clipboard fakes, state
transitions and failure/cancellation gating, style/replacement rules, hotkey
validation, settings/history components and mockIPC browser event sequences.
