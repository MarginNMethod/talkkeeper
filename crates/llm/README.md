# Language model adapters

Use `build_provider(config, &secret_store)` to obtain a boxed `LlmProvider`.
Base URLs are server roots (for example, a local server origin), without the
versioned API suffix. All four configurations require an explicit base URL.
Model identifiers always come from the caller.

Set credentials through `SecretStore::set` and put only the credential name in
`ProviderConfig`. The OS implementation uses service `org.talkkeeper.desktop`;
keychain failures are returned without a fallback. Compatible servers may omit a
credential. The in-memory implementation is intended for tests.

`complete` returns normalized text and optional token usage. `stream` returns a
stream of text deltas; errors establishing the request and errors while reading
the stream are separate results. Dropping the stream cancels further reads.
Anthropic requires callers to supply `max_tokens`. HTTP 429 and 5xx responses
receive one retry after 200 ms, before any streamed output is consumed. Other
HTTP failures and transport failures are returned immediately.

Tests use local HTTP mocks. Real provider accounts and native keychain sessions
are not required or exercised.
