# Audio capture

`Capture::start(CaptureConfig { mic_device: None, capture_system: true })`
opens the default microphone and system output. It returns `Result<CaptureHandle>`;
initialization failures do not leave a partially running session. Enumerate CPAL
microphone names with `list_input_devices()`. `Capture::start_system()` opens only
the system source and works without microphone hardware.

Read `handle.frames` and `handle.errors` concurrently. Frames are mono f32 PCM,
with separate `Source::Mic` and `Source::System` tags. Microphone sample rates stay
native; system capture requests 48 kHz. This crate does not resample, mix sources,
perform echo cancellation, or infer speakers. `rms_dbfs(&frame.samples)` supplies
an RMS level meter (silence is negative infinity).

The frame queue holds at most 128 buffers. A slow consumer receives an explicit
`CaptureError::Overflow` and both captures stop, rather than silently losing
samples. Backend errors also stop capture. Call `stop()` after an error.
`pause()` suppresses delivery while backends continue draining; previously queued
frames remain readable. `resume()` cannot restart a stopped handle. Timestamps
use monotonic elapsed time at buffer delivery, including paused time; they are
not hardware sample-clock timestamps. `stop()` joins the worker, releases native
resources, closes the frame receiver, and discards queued frames. Dropping the
handle calls `stop()` too. Permission/native initialization calls are synchronous;
call `start` off the UI thread.

Recording must follow an explicit user action with participant consent guidance.
`permissions_status()` and `request_permissions()` return platform guidance;
they do not assert that permission is granted or start recording. Native capture
initialization is the authoritative permission check.

## Platforms

- Linux: CPAL uses ALSA for the microphone. System capture uses `libpulse-binding`
  and the PulseAudio `@DEFAULT_MONITOR@` alias, resolved to the default sink's
  monitor at startup. PipeWire works through its PulseAudio compatibility server.
  Install ALSA/PulseAudio development libraries (`libasound2-dev`, `libpulse-dev`).
  Reads and startup polling are nonblocking; PulseAudio startup has a five-second
  deadline. Restart capture to follow a changed default sink.
- Windows: CPAL microphone plus WASAPI shared-mode loopback on the default render
  endpoint, requesting stereo float PCM and downmixing it. Enable microphone
  access for desktop applications in Windows Privacy settings. An inactive render
  endpoint may produce no frames until playback starts.
- macOS 14+: CPAL microphone plus ScreenCaptureKit with only an audio output
  handler. Audio from the current process is excluded using
  `excludesCurrentProcessAudio`; no video buffers are delivered or stored. A
  display must be available. Enable **Screen Recording** (on newer systems,
  **Screen & System Audio Recording**) and **Microphone** in System Settings →
  Privacy & Security. Restart the app after changing Screen Recording access.
  The embedding app must supply `NSMicrophoneUsageDescription` in its Info.plist,
  and, if sandboxed, the audio input entitlement. Build with Xcode/Swift and a
  macOS 14+ SDK. This Linux workspace cannot execute or natively build Apple APIs.

Direct dependencies use Apache-2.0 (`cpal`, `hound`), MIT (`wasapi`),
MIT OR Apache-2.0 (`libpulse-binding`, `screencapturekit`, `tokio`, `thiserror`).

## Record and verify

```sh
cargo run -p talkkeeper-audio --example record -- 5
cargo fmt --all -- --check
cargo clippy -p talkkeeper-audio --all-targets -- -D warnings
cargo test -p talkkeeper-audio
TALKKEEPER_PULSE_TEST=1 cargo test -p talkkeeper-audio -- --ignored --nocapture
```

The example writes mono float WAV files `mic.wav` and `system.wav` at each source's
sample rate when frames arrive. The PulseAudio test starts a daemon if needed,
creates `tk_test`, temporarily makes it the default sink, plays a generated 440 Hz
WAV, lets the null sink warm up for two seconds, and then checks two seconds of
monitor capture. It restores the prior default sink,
unloads its module, stops playback, and removes the WAV even on assertion failure.
The daemon is left running. It requires `pulseaudio`, `pactl`, and `paplay` and
should be run without other tests changing the default sink simultaneously.

In a container with a read-only home directory, use writable daemon directories:

```sh
mkdir -p /tmp/talkkeeper-pulse-config /tmp/talkkeeper-pulse-runtime
chmod 700 /tmp/talkkeeper-pulse-runtime
XDG_CONFIG_HOME=/tmp/talkkeeper-pulse-config \
PULSE_RUNTIME_PATH=/tmp/talkkeeper-pulse-runtime \
TALKKEEPER_PULSE_TEST=1 cargo test -p talkkeeper-audio -- --ignored --nocapture
```
