# Core storage

`Store::open(path)` opens a local SQLite database, enables foreign keys, and
applies the numbered SQL migrations transactionally. `open_in_memory()` offers
the same behavior for ephemeral use. Mutations require `&mut Store` and commit
atomically with search index changes. Errors roll back the entire operation.

Notes use UUIDs and UTC timestamps. `update_note` preserves creation and trash
timestamps; use the explicit trash and restore methods to change visibility.
`get_note` includes trashed notes, while lists, search, and CSV export omit them.
`purge_note` permanently removes either an active or trashed note and its segments.
Transcript deletion ranges use inclusive sequence numbers. Retention uses segment
creation timestamps, including segments belonging to trashed notes.

Folders permit a root and one child level. Move or delete children before deleting
a root. Deleting a folder leaves its notes unfiled. Vocabulary allows at most
100 unique terms. Settings accept JSON preferences; callers must keep all secrets
in the OS keychain rather than passing them to this API.

Search accepts SQLite FTS5 query syntax and returns ascending BM25 ranks (lower
is better), snippets marked with square brackets, and note records. Folder,
case-insensitive attendee substring, and inclusive note creation date filters
apply before the result limit. Invalid FTS queries return SQLite errors.

Markdown export includes transcripts by default; use
`export_note_markdown_with_transcript(id, false)` to omit them. CSV export uses
standard CSV quoting and writes a header even when there are no active notes.

The first implementation stores serialized domain records and rebuilds the full
FTS index inside each write transaction. This favors consistency and a small
storage contract; larger collections will need incremental indexing and more
selective SQL reads. It does not store audio or manage credentials.
