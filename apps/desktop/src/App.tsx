import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  data,
  invoke,
  type Note,
  type Segment,
  type Template,
  type Preferences,
} from "./api";
import { Editor } from "./Editor";
import { Transcript } from "./Transcript";
import { Settings } from "./Settings";
import { Templates } from "./Templates";
import { Setup } from "./Setup";
import { People, Attendees, type Person } from "./People";
import { Summary } from "./Summary";
export function App() {
  const [notes, setNotes] = useState<Note[]>([]),
    [note, setNote] = useState<Note | null>(null),
    [query, setQuery] = useState(""),
    [trash, setTrash] = useState(false),
    [snippets, setSnippets] = useState<Record<string, string>>({}),
    [segments, setSegments] = useState<Segment[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [template, setTemplate] = useState("auto"),
    [settings, setSettings] = useState<Preferences | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("stopped"),
    [captureNote, setCaptureNote] = useState<string | null>(null),
    [levels, setLevels] = useState<Record<string, number>>({}),
    [notice, setNotice] = useState(""),
    [autoStop, setAutoStop] = useState(false),
    [enhancing, setEnhancing] = useState(false),
    [folders, setFolders] = useState<{ id: string; name: string }[]>([]),
    [folder, setFolder] = useState(""),
    [progress, setProgress] = useState("");
  const [directory, setDirectory] = useState<"people" | "companies" | null>(
    null,
  );
  const [personId, setPersonId] = useState<string | undefined>();
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  useEffect(() => {
    void invoke<{ completed: boolean; custom: boolean }>("setup_status").then((s) => setSetupNeeded(!s.completed && !s.custom)).catch(fail);
  }, []);
  const current = useRef<Note | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveQueue = useRef(Promise.resolve());
  current.current = note;
  const fail = (e: unknown) => setError(String(e));
  async function refresh() {
    if (query) {
      const hits = await data<{ note: Note; snippet: string }[]>("search", {
        query,
      });
      setNotes(hits.map((h) => h.note));
      setSnippets(Object.fromEntries(hits.map((h) => [h.note.id, h.snippet])));
    } else {
      setNotes(await data<Note[]>(trash ? "trash" : "list"));
      setSnippets({});
    }
  }
  useEffect(() => {
    void refresh().catch(fail);
  }, [query, trash]);
  useEffect(() => {
    void data<Template[]>("templates").then(setTemplates).catch(fail);
    void data<{ id: string; name: string }[]>("folders")
      .then(setFolders)
      .catch(fail);
  }, []);
  useEffect(() => {
    const subscriptions = [
      listen<Segment>("transcript://segment", (e) => {
        if (e.payload.note_id === current.current?.id)
          setSegments((s) => [
            ...s.filter((x) => x.id !== e.payload.id),
            e.payload,
          ]);
      }),
      listen<{ note_id: string; delta: string }>("enhance://delta", (e) => {
        if (e.payload.note_id === current.current?.id)
          setNote((n) =>
            n
              ? {
                  ...n,
                  summary_markdown:
                    (n.summary_markdown ?? "") + e.payload.delta,
                }
              : n,
          );
      }),
      listen<{ note_id: string; state: string; error?: string }>(
        "capture://state",
        (e) => {
          setStatus(e.payload.state);
          setCaptureNote(
            e.payload.state === "stopped" ? null : e.payload.note_id,
          );
          if (e.payload.error) fail(e.payload.error);
        },
      ),
      listen<{ source: string; level: number }>("capture://level", (e) =>
        setLevels((l) => ({ ...l, [e.payload.source]: e.payload.level })),
      ),
      listen<string>("setup://error", (e) => fail(e.payload)),
      listen("capture://auto-stop-suggested", () => setAutoStop(true)),
      listen<{ downloaded: number; total: number }>("model://progress", (e) =>
        setProgress(
          `Model download: ${Math.round((e.payload.downloaded / e.payload.total) * 100)}%`,
        ),
      ),
    ];
    return () => {
      for (const p of subscriptions)
        void p.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  function persist(n: Note) {
    saveQueue.current = saveQueue.current
      .then(async () => {
        await data("update", n);
      })
      .catch(fail);
    return saveQueue.current;
  }
  async function flush() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (current.current) await persist(current.current);
    }
    await saveQueue.current;
  }
  function update(patch: Partial<Note>) {
    const n = current.current;
    if (!n) return;
    const next = { ...n, ...patch };
    current.current = next;
    setNote(next);
    setNotes((notes) =>
      notes.map((existing) => (existing.id === next.id ? next : existing)),
    );
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persist(next);
    }, 400);
  }

  async function select(n: Note) {
    await flush();
    setDirectory(null);
    setNote(n);
    setTemplate(n.template_id ?? "auto");
    setSegments(await data("segments", { id: n.id }));
  }
  async function create() {
    await flush();
    const n = await data<Note>("start_note", {});
    await select(n);
    await refresh();
  }
  async function enhance() {
    if (!note) return;
    await flush();
    setEnhancing(true);
    setNote((n) => (n ? { ...n, summary_markdown: "" } : n));
    try {
      const result = await invoke<{ text: string }>("enhance_note", {
        noteId: note.id,
        templateId: template,
      });
      setNote((n) =>
        n?.id === note.id
          ? { ...n, summary_markdown: result.text, template_id: template }
          : n,
      );
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setEnhancing(false);
    }
  }
  async function exportNote(format: string, copy = false) {
    if (!note && format !== "csv") return;
    await flush();
    await data("export", { id: note?.id, format, copy, save: !copy });
  }
  async function capture(command: string) {
    await flush();
    await invoke(command, { noteId: note?.id });
    if (command === "start_capture") setNotice(await data<string>("notice"));
  }
  async function mutate(action: string) {
    if (!note) return;
    await flush();
    await data(action, { id: note.id });
    setNote(null);
    setSegments([]);
    await refresh();
  }
  return (
    <main>
      <aside className="sidebar">
        <h1>TalkKeeper</h1>
        <button disabled={setupNeeded !== false} onClick={() => void create().catch(fail)}>New note</button>
        <input
          aria-label="Search notes"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() => {
            setDirectory(null);
            setTrash(false);
          }}
        >
          Notes
        </button>
        {(["people", "companies"] as const).map((kind) => (
          <button
            key={kind}
            onClick={() =>
              void flush()
                .then(() => {
                  setPersonId(undefined);
                  setDirectory(kind);
                })
                .catch(fail)
            }
          >
            {kind === "people" ? "People" : "Companies"}
          </button>
        ))}
        <button onClick={() => { setDirectory(null); setTrash(true); }}>Trash</button>
        <label>
          Folder
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            const name = window.prompt("Folder name");
            if (name)
              void data("save_folder", {
                folder: { id: crypto.randomUUID(), name, parent_id: null },
              })
                .then(() => data<typeof folders>("folders"))
                .then(setFolders)
                .catch(fail);
          }}
        >
          New folder
        </button>
        {folder && (
          <>
            <button
              onClick={() => {
                const name = window.prompt("Rename folder");
                if (name)
                  void data("save_folder", {
                    folder: { id: folder, name, parent_id: null },
                    update: true,
                  })
                    .then(() => data<typeof folders>("folders"))
                    .then(setFolders)
                    .catch(fail);
              }}
            >
              Rename folder
            </button>
            <button
              onClick={() =>
                void data("delete_folder", { id: folder })
                  .then(() => {
                    setFolder("");
                    return data<typeof folders>("folders");
                  })
                  .then(setFolders)
                  .then(refresh)
                  .catch(fail)
              }
            >
              Delete folder
            </button>
          </>
        )}
        <nav>
          {notes
            .filter((n) => !folder || n.folder_id === folder)
            .map((n, i, a) => (
              <div key={n.id}>
                {(i === 0 ||
                  n.created_at.slice(0, 10) !==
                    a[i - 1].created_at.slice(0, 10)) && (
                  <h3>{new Date(n.created_at).toLocaleDateString()}</h3>
                )}
                <button
                  className={note?.id === n.id ? "active" : ""}
                  onClick={() => void select(n).catch(fail)}
                >
                  {n.title}
                  <small>{snippets[n.id]}</small>
                </button>
              </div>
            ))}
        </nav>
        <button
          onClick={() =>
            void data<Preferences>("settings").then(setSettings).catch(fail)
          }
        >
          Settings
        </button>
      </aside>
      <div className="workspace">
        {error && (
          <div role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {progress && <p role="status">{progress}</p>}
        {settings ? (
          <Settings
            initial={settings}
            onClose={() => { setSettings(null); void invoke<{ completed: boolean; custom: boolean }>("setup_status").then((s) => setSetupNeeded(!s.completed && !s.custom)).catch(fail); }}
            onError={fail}
          />
        ) : setupNeeded !== false ? (
          setupNeeded === null ? <p role="status">Checking setup…</p> : <Setup onReady={() => { setSetupNeeded(false); void create().catch(fail); }} onAdvanced={() => void data<Preferences>("settings").then((p) => setSettings({ ...p, provider: "Ollama" })).catch(fail)} />
        ) : directory ? (
          <People
            key={directory + (personId ?? "")}
            kind={directory}
            initialPerson={personId}
            onError={fail}
            onSelect={(n) => void select(n).catch(fail)}
            onStart={(p: Person) =>
              void (async () => {
                await flush();
                const n = await data<Note>("start_note", {});
                const next = {
                  ...n,
                  attendees: [{ name: p.name, email: p.email }],
                };
                await data("update", next);
                await select(next);
                await refresh();
              })().catch(fail)
            }
          />
        ) : note ? (
          <>
            <header>
              <input
                className="title"
                aria-label="Note title"
                value={note.title}
                onChange={(e) => update({ title: e.target.value })}
              />
              <span className="pill">
                {status}
                {captureNote && captureNote !== note.id
                  ? " · another note"
                  : ""}
              </span>
              <details>
                <summary>Export</summary>
                {[
                  ["summary", "Copy summary as Markdown"],
                  ["transcript", "Copy transcript"],
                  ["markdown", "Export Markdown"],
                  ["transcript", "Export transcript"],
                  ["csv", "Export CSV"],
                ].map(([format, label], i) => (
                  <button
                    key={label}
                    onClick={() => void exportNote(format, i < 2).catch(fail)}
                  >
                    {label}
                  </button>
                ))}
              </details>
              {trash ? (
                <>
                  <button onClick={() => void mutate("restore").catch(fail)}>
                    Restore
                  </button>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "Permanently delete this note and transcript?",
                        )
                      )
                        void mutate("purge").catch(fail);
                    }}
                  >
                    Permanently delete
                  </button>
                </>
              ) : (
                <button
                  disabled={captureNote === note.id}
                  onClick={() => void mutate("delete").catch(fail)}
                >
                  Move to trash
                </button>
              )}
            </header>
            <Attendees
              key={note.id}
              value={note.attendees}
              onChange={(attendees) => update({ attendees })}
              onOpen={(id) =>
                void flush()
                  .then(async () => {
                    const people = await data<Person[]>("people");
                    const p = people.find(
                      (p) =>
                        p.id === id ||
                        p.email.toLowerCase() === id.toLowerCase() ||
                        p.name.toLowerCase() === id.toLowerCase(),
                    );
                    if (p) {
                      setPersonId(p.id);
                      setDirectory("people");
                    }
                  })
                  .catch(fail)
              }
            />
            <label>
              File in
              <select
                value={note.folder_id ?? ""}
                onChange={(e) => update({ folder_id: e.target.value || null })}
              >
                <option value="">Unfiled</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="capture">
              <p>Obtain participant consent before recording.</p>
              <button
                disabled={status !== "stopped" || trash}
                onClick={() => void capture("start_capture").catch(fail)}
              >
                Start capture
              </button>
              <button
                disabled={status !== "recording"}
                onClick={() => void capture("pause_capture").catch(fail)}
              >
                Pause
              </button>
              <button
                disabled={status !== "paused"}
                onClick={() => void capture("resume_capture").catch(fail)}
              >
                Resume
              </button>
              <button
                disabled={status === "stopped"}
                onClick={() => void capture("stop_capture").catch(fail)}
              >
                Stop
              </button>
              {Object.entries(levels).map(([source, level]) => (
                <label key={source}>
                  {source}
                  <meter min="-100" max="0" value={level} />
                </label>
              ))}
              {notice && (
                <div>
                  <p>{notice}</p>
                  <button onClick={() => void data("copy_notice").catch(fail)}>
                    Copy notice
                  </button>
                </div>
              )}
              {autoStop && (
                <div role="alert">
                  There has been a long silence. Stop recording?
                  <button
                    onClick={() => {
                      setAutoStop(false);
                      void capture("stop_capture").catch(fail);
                    }}
                  >
                    Stop recording
                  </button>
                  <button onClick={() => setAutoStop(false)}>
                    Keep recording
                  </button>
                </div>
              )}
            </div>
            <div className="columns">
              <div>
                <h2>Your notes</h2>
                <Editor
                  key={note.id}
                  content={note.notes_markdown}
                  document={note.notes_doc}
                  editable={!enhancing && !trash}
                  onChange={(notes_doc, notes_markdown) =>
                    update({ notes_doc, notes_markdown })
                  }
                />
                <div className="summary-tools">
                  <label>
                    Template
                    <select
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={enhancing || trash}
                    onClick={() => void enhance()}
                  >
                    {enhancing
                      ? "Enhancing…"
                      : note.summary_markdown
                        ? "Regenerate"
                        : "Enhance"}
                  </button>
                </div>
                <Templates
                  templates={templates}
                  onChange={() =>
                    void data<Template[]>("templates")
                      .then(setTemplates)
                      .catch(fail)
                  }
                  onError={fail}
                />
                <h2>Summary</h2>
                <textarea
                  aria-label="Edit summary"
                  className="summary"
                  readOnly={enhancing || trash}
                  value={note.summary_markdown ?? ""}
                  onChange={(e) => update({ summary_markdown: e.target.value })}
                />
                <Summary
                  markdown={note.summary_markdown ?? ""}
                  segments={segments}
                />
              </div>
              <Transcript
                segments={segments}
                onDelete={(ids) =>
                  void data("delete_segments", { id: note.id, ids })
                    .then(() =>
                      setSegments((s) => s.filter((x) => !ids.includes(x.id))),
                    )
                    .catch(fail)
                }
                onCopy={() => void exportNote("transcript", true).catch(fail)}
              />
            </div>
          </>
        ) : (
          <section className="empty">
            <h2>A place to collect the conversation</h2>
            <p>
              Create a note to write, record, and find the details that matter.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
