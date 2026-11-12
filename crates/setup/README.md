# Automatic local setup

`Setup::plan` detects physical RAM, CPU architecture, OS, available storage on the
application data volume, and graphics hardware where detectable. Planning is local:
it does not start an engine or contact a server. `model-catalog.json` is the only
source of recommended AI identifiers. Serde rejects unknown/missing fields and
validation checks tier order, finite positive sizes, required license notes, and
speech identifiers/sizes against the transcription catalog. RAM tiers use rounded
GiB; storage/download estimates use decimal GB. A smaller tier is chosen when the
preferred tier cannot fit with 30% storage headroom. Engine storage is conservatively
estimated at 4 GB, including unpacked libraries. Unsupported GPUs can use CPU inference.

Call `run_setup` only after consent. Stages check storage, find/download the engine,
start it, download the AI model, download/verify speech weights, and test an answer
through `talkkeeper-llm`. Cancellation drops network requests and owned engines.
Engine archives use temporary directories, SHA-256 from the pinned release's
`sha256sum.txt` when published, safe extraction, and an executable version check.
Missing checksum files permit archive/version verification; a present checksum file
without the matching entry is rejected. ZIP/tar paths cannot escape the destination;
archive symlinks are materialized as checked regular files, never followed while
writing. Interrupted engine/speech archives are downloaded anew; Ollama resumes
partially downloaded AI weights. Completed engine/speech downloads are reused.

The runtime first attaches to 127.0.0.1:11434 and never stops that server. Otherwise
it searches the managed directory, PATH and standard application directories, then
starts a private loopback child (11500, or a free port). Its models live under
application data, together with a private engine profile and temporary directory.
Only the child receives its isolated profile environment. The owner must be retained while inference is in use. Dropping it
stops only its child. Unexpected exits trigger up to three restarts with backoff.
Later app launches resume the engine without downloading. Desktop stores
`setup.completed`, `setup.llm_tag`, `setup.whisper_model`, `setup.runtime_port` and
an in-progress plan in the core Settings table; credentials remain in the OS keychain.

## Network destinations and privacy

After consent, engine downloads contact **ollama.com**, **github.com** release
assets and their **release-assets.githubusercontent.com** / **objects.githubusercontent.com**
redirects. AI weights use **registry.ollama.ai** and its blob CDN hosts (including
***.r2.cloudflarestorage.com**). Speech weights use **huggingface.co** and its
weight delivery redirects (**cdn-lfs.huggingface.co**, **cdn-lfs-us-1.hf.co**,
**cas-bridge.xethub.hf.co**). These are asset delivery services; meeting content is
not sent to them. Ollama inference stays on loopback and managed engines have
cloud features disabled. Runtime archive redirects are restricted to the listed
Ollama/GitHub hosts. The engine and speech model manager follow their own asset
redirects. No catalog refresh runs in the background. There is no telemetry.
Advanced user-configured providers contact the user's chosen endpoints instead.

## Verification

`cargo test -p talkkeeper-setup` covers catalog boundaries, disk fallback, schema
validation, malicious archive paths, checksums, streamed progress, mock runtime
installation, speech verification, existing engine reuse, offline retry, and cancellation.
On Linux, the ignored real test downloads the official runtime and a small test-only
model, checks a non-empty answer through the LLM adapter, and removes all downloaded
assets via a temporary directory:

```sh
cargo test -p talkkeeper-setup --test setup real_linux_ollama_chat -- --ignored --nocapture
```
