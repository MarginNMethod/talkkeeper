# Contributing to TalkKeeper

Open an issue describing the problem or intended behavior before substantial work.
For a small fix, submit a focused pull request with a clear explanation and the
checks you ran. Use conventional commit messages such as `fix: clarify consent copy`.

Write original code, copy, prompts, templates, icons, and documentation. Do not
reference or imitate commercial meeting-notes products. Never commit wording-guard
terms, credentials, real meeting recordings, or personal transcripts.

Use only the permissive licenses allowed in `deny.toml`. Review transitive
licenses when dependencies change. Keep lockfiles committed. Do not set a default
LLM model identifier: model selection belongs to the user. Store secrets only in
the OS keychain through `keyring`, never in database rows or configuration files.

Follow the setup in README.md. Before submitting, run:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm -r test
pnpm -r build
bash scripts/ip-guard.sh
cargo deny check licenses
```

Include meaningful tests for behavior changes. Gate platform-specific Rust code
with the appropriate `#[cfg(target_os = "...")]` and document limitations.
Contributions are licensed under Apache-2.0. Follow CODE_OF_CONDUCT.md in all
project spaces. To report conduct concerns, use the repository's private security
reporting channel with a subject identifying a conduct report; maintainers will
handle reports confidentially and recuse themselves when directly involved.
