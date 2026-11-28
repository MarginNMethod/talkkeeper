import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton, Popover } from "@talkkeeper/ui";
import { Attendees } from "./People";
import { Editor } from "./Editor";
import { Summary } from "./Summary";
import { NoteWorkspace } from "./NoteWorkspace";
import { SnapshotGallery } from "./Snapshots";
import type { Segment, Note } from "./api";

export function NotePage({
  note,
  segments,
  readOnly,
  writing,
  update,
  onError,
  notices,
  recording,
  calendar,
  header,
  controls,
  transcript,
  chat,
}: {
  note: Note;
  segments: Segment[];
  readOnly: boolean;
  writing: boolean;
  update: (changes: Partial<Note>) => void;
  onError: (error: unknown) => void;
  notices: ReactNode;
  recording: ReactNode;
  calendar: ReactNode;
  header: ReactNode;
  controls: ReactNode;
  transcript: ReactNode;
  chat: ReactNode;
}) {
  const mounted = useRef(false);
  const lastBody = useRef({
    doc: JSON.stringify(note.notes_doc ?? null),
    md: note.notes_markdown,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [note.id]);
  return (
    <article className="note-page">
      {notices}
      {header}
      {calendar}
      <NoteWorkspace
        notes={
          <Editor
            content={note.notes_markdown}
            document={note.notes_doc}
            editable={!readOnly}
            onChange={(notes_doc, notes_markdown) => {
              const doc = JSON.stringify(notes_doc ?? null);
              const prev = lastBody.current;
              lastBody.current = { doc, md: notes_markdown };
              if (
                mounted.current &&
                !readOnly &&
                (notes_markdown !== prev.md || (prev.doc !== "null" && doc !== prev.doc))
              )
                update({ notes_doc, notes_markdown });
            }}
          />
        }
        written={
          <Summary markdown={note.summary_markdown ?? ""} segments={segments} />
        }
        summary={note.summary_markdown ?? ""}
        onEdit={(summary_markdown) => update({ summary_markdown })}
        readOnly={readOnly}
        writing={writing}
        controls={controls}
        transcript={
          <>
            <SnapshotGallery
              key={note.id}
              noteId={note.id}
              onError={onError}
              onSeek={(ms) => {
                const segment =
                  [...segments].reverse().find((item) => item.start_ms <= ms) ??
                  segments[0];
                if (segment)
                  document
                    .getElementById(`segment-${segment.seq}`)
                    ?.scrollIntoView?.({ behavior: "smooth" });
              }}
            />
            {transcript}
          </>
        }
      />
      {chat}
      {recording}
    </article>
  );
}

export function NoteLoadState({
  status,
  title,
  onRetry,
  onBack,
}: {
  status: "loading" | "error";
  title?: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <article className="note-page">
      {status === "loading" ? (
        <section
          className="note-state-loading"
          role="status"
          aria-busy="true"
          aria-label="Opening note"
        >
          {title ? (
            <h1 className="note-state-title">{title}</h1>
          ) : (
            <div className="note-state-skeleton-title" aria-hidden="true" />
          )}
          <p className="note-state-copy">Opening note…</p>
          <div className="note-state-skeleton-line" aria-hidden="true" />
          <div
            className="note-state-skeleton-line note-state-skeleton-line-short"
            aria-hidden="true"
          />
        </section>
      ) : (
        <section className="note-state-error" role="alert">
          <h2>Couldn't open this note</h2>
          <p>
            Something went wrong while loading this note. Your saved notes
            haven't changed.
          </p>
          <div className="note-state-actions">
            <button type="button" className="primary" onClick={onRetry}>
              Retry
            </button>
            <button type="button" className="secondary" onClick={onBack}>
              Back to Home
            </button>
          </div>
        </section>
      )}
    </article>
  );
}

export type NoteSaveStatus = "idle" | "saving" | "saved" | "failed";

export function NoteHeader({
  note,
  folders,
  update,
  recording,
  canEnhance,
  onEnhance,
  onExport,
  onRestore,
  onTrash,
  onPurge,
  onOpen,
  saveStatus = "idle",
  failed = false,
  undoFailed = false,
  onRetrySave,
  onDiscardDraft,
  deleting = false,
}: {
  note: Note;
  folders: { id: string; name: string }[];
  update: (changes: Partial<Note>) => void;
  recording: boolean;
  canEnhance: boolean;
  onEnhance: () => void;
  onExport: (format: string, copy: boolean) => void;
  onRestore: () => void;
  onTrash: () => void;
  onPurge: () => void;
  onOpen: (id: string) => void;
  saveStatus?: NoteSaveStatus;
  failed?: boolean;
  undoFailed?: boolean;
  onRetrySave?: () => void;
  onDiscardDraft?: () => void;
  deleting?: boolean;
}) {
  const folderName =
    folders.find((folder) => folder.id === note.folder_id)?.name ?? "No folder";
  return (
    <>
      <header className="note-header">
        <textarea
          className="title"
          rows={1}
          aria-label="Note title"
          value={note.title}
          readOnly={!!note.deleted_at || deleting}
          onChange={(event) => update({ title: event.target.value })}
        />
        <Popover label="More actions for this note">
          {[
            ["summary", "Copy summary"],
            ["markdown", "Notes and summary"],
            ["transcript", "Export transcript"],
            ["csv", "Save a list of all notes as a spreadsheet file (.csv)"],
          ].map(([format, label], index) => (
            <button key={format} onClick={() => onExport(format, index === 0)}>
              {label}
            </button>
          ))}
          <Button variant="quiet" disabled={!canEnhance} onClick={onEnhance}>
            Write up my notes
          </Button>
          {note.deleted_at ? (
            <>
              <button onClick={onRestore}>Restore</button>
              <button onClick={onPurge}>Delete forever</button>
            </>
          ) : (
            <button
              disabled={recording || saveStatus === "saving" || deleting}
              title={
                recording
                  ? "Stop the recording before moving this note to the trash."
                  : deleting ? undefined : saveStatus === "saving" ? "Wait for changes to finish saving before moving this note to Trash." : undefined
              }
              onClick={onTrash}
            >
              Move to Trash
            </button>
          )}
        </Popover>
      </header>
      <div className="note-metadata">
        <Popover
          label={`${new Date(note.created_at).toLocaleString()} · ${note.attendees.length ? note.attendees.map((person) => person.name).join(", ") : "Add people"} · ${folderName}`}
          closeOnAction={false}
        >
          <fieldset disabled={!!note.deleted_at || deleting}>
            <Attendees
              key={note.id}
              value={note.attendees}
              onChange={(attendees) => update({ attendees })}
              onOpen={onOpen}
            />
            <label>
              Folder{" "}
              <select
                value={note.folder_id ?? ""}
                onChange={(event) =>
                  update({ folder_id: event.target.value || null })
                }
              >
                <option value="">No folder</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </Popover>
        <span className="note-save-status" role="status" aria-live="polite" data-status={saveStatus}>
          {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : ""}
        </span>
      </div>
      {failed && (
        <div className="note-save-error" role="alert" key={note.id}>
          <p>{undoFailed ? "Couldn't restore the earlier version. Your latest edits are already saved." : "Changes couldn't be saved. Your draft is kept until you close Talkkeeper."}</p>
          <button type="button" className="note-save-retry" disabled={saveStatus === "saving" || deleting} onClick={onRetrySave}>Retry save</button>
          <button type="button" className="note-save-discard" disabled={deleting} onClick={onDiscardDraft}>Discard</button>
        </div>
      )}
    </>
  );
}

export function AskBar({
  children,
}: {
  children: (question: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  return (
    <section className="note-question">
      <form
        className="note-ask-bar"
        onSubmit={(event) => {
          event.preventDefault();
          setQuestion(draft);
          setOpen(true);
        }}
      >
        <input
          aria-label="Ask about this note"
          placeholder="Ask about this note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <IconButton
          aria-label="Ask about this note"
          aria-expanded={open}
          type="submit"
        >
          ↗
        </IconButton>
      </form>
      {open && children(question)}
    </section>
  );
}
