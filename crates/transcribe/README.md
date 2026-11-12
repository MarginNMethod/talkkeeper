# Speech pipeline

The default `whisper` feature builds whisper.cpp through whisper-rs and needs a
C/C++ toolchain, CMake, and libclang. `cloud` enables the two network adapters.
No engine depends on storage or reads credentials from disk. The caller explicitly
selects an engine, supplies cloud credentials from its credential store, and owns
recording consent and cloud-transfer UI.

Load a local engine with `LocalEngine::load(model_path).await`, then call
`SttEngine::start(options).await`. Take the event stream with `session.events()`
once and drain it concurrently with `push` and `finish`. Both queues have capacity
eight: consumers must keep reading to allow producers to progress. Audio chunks
are mono, finite f32 samples, at most 30 seconds each, with recording-relative
timestamps. `finish` queues an end marker; the event stream closes after all
pending results. Dropping the session aborts its worker. Native inference already
running on Tokio's blocking pool can finish after cancellation.

Mic and System are processed independently and map to “Me” and “Them”.
The pure Rust VAD combines RMS energy and zero-crossing rate over 20 ms frames,
with configurable silence and energy thresholds in `VadConfig`. Utterances are
limited to 30 seconds. This is a lightweight heuristic, not a trained speech
classifier: quiet voices and background sound need evaluation on real recordings.
Rubato performs rate conversion to 16 kHz. Local inference uses fresh segment
state, language auto-detection for `Language::Auto`, and at most 30 vocabulary
terms as the initial prompt. English-only models should use `Language::Code("en")`;
multilingual detection requires a multilingual model.

`SilenceMonitor` consumes a monotonic recording clock and a speech flag across
both channels. The capture/orchestration layer must call it even during silence;
it suggests stopping once per silent interval and never stops recording itself.

`ModelManager::new(app_data)` stores verified model files under `app_data/models`.
The catalog lists unquantized multilingual tiny/base/small/medium/large-v3-turbo
and published English-only variants (there is no large-v3-turbo.en).
URLs, byte sizes, and SHA-256 values come from the public whisper.cpp Hugging Face
repository LFS metadata. Existing files are hash-checked. Downloads use unique
temporary files, verify size/hash, and rename only on success. Progress callbacks
receive downloaded and expected bytes. Cancelled downloads are removed; downloads
do not resume.

For cloud use, `OpenAiCompatible::new` takes the full transcription endpoint,
API key, and caller-selected model. Each VAD segment becomes a 16 kHz PCM WAV
multipart request. `Deepgram` takes an explicit WebSocket endpoint, API key, and
model; it opens one connection per channel, emits interim/final responses, sends
keepalives, and drains results on CloseStream. Vocabulary uses Nova-3 keyterm
prompting or legacy keywords for older models. Auto language uses multilingual
mode, so choose a compatible model. Endpoint/model capabilities remain the
caller's responsibility. Network errors omit credentials and provider response
bodies. Neither adapter retries billable requests automatically.

Validation:

```sh
cargo fmt --all -- --check
cargo clippy -p talkkeeper-transcribe --all-targets -- -D warnings
cargo test -p talkkeeper-transcribe
cargo clippy -p talkkeeper-transcribe --all-targets --all-features -- -D warnings
cargo test -p talkkeeper-transcribe --all-features
cargo test -p talkkeeper-transcribe -- --ignored
```

The ignored test downloads tiny.en and the public JFK sample into
`target/transcribe-fixtures`, then performs native inference. Normal tests use
synthetic audio and local HTTP/WebSocket mocks; they need no provider accounts.
whisper-rs and whisper-rs-sys use the permissive Unlicense; the workspace license
allowlist will need to include it when auditing these new dependencies.
