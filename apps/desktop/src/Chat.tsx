import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { data, invoke, type Note, type Segment, type Preferences } from "./api";
import { Setup } from "./Setup";
import { Summary } from "./Summary";
interface Message {
  id: string;
  role: string;
  content: string;
  proposed_edit_id: string | null;
  revision: string | null;
}
interface Version {
  id: string;
  content: string | null;
  created_at: string;
}
const chips = [
  "List action items",
  "What did we decide?",
  "Rewrite these notes shorter",
  "Make this more formal",
  "Add a section about X",
];
export function Chat({
  note,
  segments,
  beforeRequest,
  onNote,
  onSettings,
  locked = false,
}: {
  note: Note;
  segments: Segment[];
  beforeRequest: () => Promise<void>;
  onNote: (note: Note) => void;
  onSettings?: () => void;
  /** True while the summary is still being written, so edits can't collide. */
  locked?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [versions, setVersions] = useState<Version[]>([]),
    [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false),
    [stream, setStream] = useState(""),
    [error, setError] = useState(""),
    [privacy, setPrivacy] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [lastRequest, setLastRequest] = useState<{
    text: string;
    redo: boolean;
    edit: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(false),
    [instructions, setInstructions] = useState("");
  async function reload() {
    setMessages((await data<Message[]>("chat_history", { id: note.id })) ?? []);
    setVersions((await data<Version[]>("versions", { id: note.id })) ?? []);
  }
  useEffect(() => {
    void reload().catch((e) => setError(String(e)));
    void data<Preferences>("settings")
      .then((p) => {
        const host = new URL(p.base_url || "http://localhost:11434").hostname;
        const local =
          p.provider === "Automatic" ||
          ((p.provider ?? "Ollama") === "Ollama" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(host));
        setPrivacy(
          local
            ? "Local AI: this conversation stays on your machine."
            : `Cloud provider active (${p.provider}): note content is sent to your selected endpoint.`,
        );
      })
      .catch((e) => setError(String(e)));
  }, [note.id]);
  useEffect(() => {
    const sub = listen<{ note_id: string; delta: string }>(
      "chat://delta",
      (e) => {
        if (e.payload.note_id === note.id)
          setStream((s) => s + e.payload.delta);
      },
    );
    return () => {
      void sub.then((f) => f());
    };
  }, [note.id]);
  async function ask(text = question, redo = false, edit = revision) {
    setLastRequest({ text, redo, edit });
    setError("");
    setStream("");
    setBusy(true);
    try {
      await beforeRequest();
      await invoke("chat_note", {
        noteId: note.id,
        question: text,
        revise:
          edit ||
          /\b(rewrite|shorter|formal|add.*section|change|redo|shorten|reformat|revise|edit)\b/i.test(
            text,
          ),
        redo,
      });
      setQuestion("");
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setStream("");
    }
  }
  async function mutate(action: string, edit: string) {
    try {
      await beforeRequest();
      const updated = await data<Note>(action, { id: note.id, edit });
      onNote(updated);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <section className="chat" aria-label="Chat with this note">
        <h2>Chat</h2>
        <p>{privacy}</p>
        {!segments.length && <p>This note has no transcript yet.</p>}
        <button
          disabled={busy || locked}
          onClick={() =>
            void data("clear_chat", { id: note.id })
              .then(reload)
              .catch((e) => setError(String(e)))
          }
        >
          Clear chat
        </button>
        <div>
          {chips.map((chip, i) => (
            <button
              key={chip}
              disabled={busy || locked || !segments.length}
              onClick={() => {
                setQuestion(chip);
                setRevision(i >= 2);
              }}
            >
              {chip}
            </button>
          ))}
        </div>
        {messages.map((m) => (
          <article key={m.id}>
            <strong>{m.role}</strong>
            {m.revision && m.proposed_edit_id ? (
              <div aria-label="Proposed revision">
                <h3>Proposed revision</h3>
                <div className="revision-diff">
                  <div>
                    <h4>Current</h4>
                    <pre>{note.summary_markdown}</pre>
                  </div>
                  <div>
                    <h4>Proposed</h4>
                    <pre>{m.revision}</pre>
                  </div>
                </div>
                <button
                  disabled={busy || locked}
                  onClick={() =>
                    void mutate("apply_revision", m.proposed_edit_id!)
                  }
                >
                  Apply
                </button>
                <button
                  disabled={busy || locked}
                  onClick={() =>
                    void mutate("discard_revision", m.proposed_edit_id!)
                  }
                >
                  Discard
                </button>
              </div>
            ) : (
              <Summary markdown={m.content} segments={segments} />
            )}
          </article>
        ))}
        {busy && <div role="status">{stream || "Thinking…"}</div>}
        {error && (
          <div role="alert">
            {error}
            <button
              disabled={busy || locked}
              onClick={() =>
                void ask(
                  lastRequest?.text ?? question,
                  lastRequest?.redo ?? false,
                  lastRequest?.edit ?? revision,
                )
              }
            >
              Retry
            </button>
            <button onClick={() => setShowSetup(true)}>
              Repair local AI setup
            </button>
            <button onClick={onSettings}>Open Settings</button>
          </div>
        )}
        {showSetup && (
          <Setup
            onReady={() => setShowSetup(false)}
            onAdvanced={() => {
              setShowSetup(false);
              onSettings?.();
            }}
          />
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label>
            Message
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={revision}
              onChange={(e) => setRevision(e.target.checked)}
            />
            Propose a notes revision
          </label>
          <button disabled={busy || locked || !question.trim() || !segments.length}>
            Send
          </button>
        </form>
        {versions.length > 0 && (
          <>
            <button
              disabled={busy || locked}
              onClick={() => void mutate("restore_summary", versions[0].id)}
            >
              Undo
            </button>
            <details>
              <summary>Version history</summary>
              {versions.map((v) => (
                <div key={v.id}>
                  <time>{v.created_at}</time>
                  <pre>{v.content}</pre>
                  <button
                    disabled={busy || locked}
                    onClick={() => void mutate("restore_summary", v.id)}
                  >
                    Restore this version
                  </button>
                </div>
              ))}
            </details>
          </>
        )}
      </section>
      <section aria-label="Redo enhanced notes">
        <h2>Redo enhanced notes</h2>
        <label>
          Extra instructions
          <input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <button
          disabled={busy || locked || !segments.length}
          onClick={() =>
            void ask(
              instructions ||
                "Redo the notes using the selected source material",
              true,
              true,
            )
          }
        >
          Redo notes
        </button>
      </section>
    </>
  );
}
