# Screen snapshot testing

## Automated checks

Run the workspace Rust format, clippy and test commands in README, followed by
`pnpm -r lint`, `pnpm -r test`, and `pnpm -r build`. Run the desktop Playwright suite
three consecutive times with `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`
when using the container browser. The snapshot test uses mock IPC, fresh returned
objects and UI conditions; it does not capture the container screen.

Core tests cover migration from schema 004 or 005 to 006, reopening, file limits,
count limits, exclusion, retention, trash/restore and permanent deletion. Native
capture uses a trait fake to test default source selection, own-window rejection,
change detection and recording state. Provider tests use HTTP mocks for metadata
and image payloads. Real permissions and compositor behavior require hand tests.

## macOS

1. Build the default debug app without `macos-system-audio`. Start with Screen
   Recording permission denied. Start microphone capture, choose **Capture shared
   screen**, read the privacy explanation, and check the confirmation. Verify the
   system permission request and actionable guidance when it is declined. Enable
   TalkKeeper in System Settings → Privacy & Security → Screen Recording and
   restart the app. Permission wording varies by OS version.
2. Choose a slide window by name. TalkKeeper must not appear in the picker. Leave
   the source blank to select the frontmost eligible window on the main display.
   Start snapshots and verify the visible on badge and count. Change slides after
   ten seconds: keep one clear image; leave slides unchanged: count stays steady.
3. Pause meeting capture and change slides. Count must stay steady. Resume and
   check the new slide. **Stop snapshots** must stop only images. Stop meeting
   capture: no more images. Switch notes and open Settings while recording; the
   global badge and stop control must remain visible.
4. Choose a display. Bring TalkKeeper onto it, including across a display edge.
   Its visible rectangle must be black in saved images, including Retina scaling.
   Minimize/close the selected window: the app must report an error rather than
   switch to another source. Verify JPEG colors, legible slide text, aspect ratio,
   and maximum long edge of 1600 pixels on both Retina and ordinary displays.
5. Check gallery timestamps and transcript links; exclude an image, delete one,
   and delete all. Trash/restore must preserve files; permanent purge must remove
   them. Restart with a shorter snapshot retention and verify old files disappear.

## Windows and Linux X11

Repeat source selection, slide changes, pause/resume, display masking, deletion,
retention and quality checks above. Windows should not request Screen Recording
permission. Verify multiple monitors, display scaling and window minimization.
On Linux X11, check a desktop with EWMH window metadata. On Wayland, opening source
selection must show that snapshots are unsupported and suggest an X11 session;
audio capture should remain usable.

## AI and privacy

- Defaults: **Ask each time**, no screen images before explicit confirmation.
  **Always on** reuses privacy consent and selects the default window on later
  meetings; **Never** blocks enabling. A first-time Always on selection still
  requires confirmation. Stop and pause remain available in every preference.
- With a text-only or unknown-capability model, verify the saved-but-not-used
  notice and that AI requests contain no images. For Ollama, select a model whose
  `/api/show` advertises `vision`; verify included JPEGs reach the loopback engine.
- With a cloud model that advertises image metadata, generation must be blocked
  until **Review cloud image sharing → Allow images for this provider**. Cancel
  must preserve local-only storage. Change the provider or endpoint and verify
  fresh approval is required. An Ollama endpoint outside loopback also requires
  approval. Excluded images must never occur in the request.
- Local image descriptions for text-only models are not implemented. Providers
  that do not publish usable capability metadata are treated as text-only.

## Capture dependency audit

Snapshots pin `xcap` 0.0.14 (Apache-2.0), whose published macOS backend uses
`core-graphics` 0.24 and `core-foundation` 0.10. Its source declares no build script
or Swift dependency. See the [published manifest](https://docs.rs/crate/xcap/0.0.14/source/Cargo.toml)
and [macOS source](https://docs.rs/crate/xcap/0.0.14/source/src/macos/capture.rs).
Run these against the default desktop dependency graph after dependency changes:

```sh
cargo tree -p talkkeeper-desktop --target aarch64-apple-darwin -i apple-metal
cargo tree -p talkkeeper-desktop --target aarch64-apple-darwin -i screencapturekit
cargo tree -p talkkeeper-desktop --target aarch64-apple-darwin | grep -i swift
cargo deny check licenses
```

The first two commands should report no matching package; the third should print
nothing. The existing optional macOS system-audio feature is separate and is not
enabled by snapshots. No real-screen capture is exercised by container tests.

## Concurrent migration integration

Migration 005 belongs to voice typing in its separate worktree. This branch adds
006 directly after 004 and accepts databases already marked 005. When integrating
both branches, retain the 005 migration block before 006 and keep the maximum
schema version at 006. No placeholder 005 file is introduced here.
