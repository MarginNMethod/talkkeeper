import { Agenda, CalendarLink, CalendarReminder, CalendarAutoCapture } from "./Calendar";
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
import { SetupCard } from "./SetupCard";
import { useSetup } from "./useSetup";
import { People, Attendees, type Person } from "./People";
import { WorkspaceChat } from "./WorkspaceChat";
import { Chat } from "./Chat";
import { CopyTranscript } from "./CopyTranscript";
import { SnapshotControls, SnapshotGallery } from "./Snapshots";
import { CaptureFeedback, MicrophoneSettingsButton } from "./CaptureFeedback";
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
    [starting, setStarting] = useState(false),
    [systemAudio, setSystemAudio] = useState(true),
    [warning, setWarning] = useState<{note_id:string; kind:string; active:boolean} | null>(null),
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
  const startPending = useRef(false);
  useEffect(() => { void invoke<{system_audio:boolean}>("capture_capabilities").then(c => setSystemAudio(c.system_audio)).catch(fail); }, []);
  const [agenda, setAgenda] = useState(false);
  const [personId, setPersonId] = useState<string | undefined>();
  const [workspaceChat, setWorkspaceChat] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [citationSeq, setCitationSeq] = useState<number | null>(null);
  useEffect(() => { if (citationSeq !== null && !workspaceChat) document.getElementById(`segment-${citationSeq}`)?.scrollIntoView?.({ behavior: "smooth" }); }, [segments, workspaceChat, citationSeq]);
  const setup = useSetup();
  const [setupChoice, setSetupChoice] = useState(false);
  const [firstRunNote,setFirstRunNote] = useState<string | null>(null);
  useEffect(()=>{
    if(!firstRunNote || note?.id !== firstRunNote) return;
    const focus = () => {
      const editor = document.querySelector<HTMLElement>('[aria-label="Rough notes"]');
      if(editor) { editor.focus(); observer.disconnect(); }
    };
    const observer = new MutationObserver(focus);
    observer.observe(document.body,{childList:true,subtree:true});
    const frame = requestAnimationFrame(focus);
    return ()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[firstRunNote,note?.id]);
  const setupNeeded = !setupChoice && !setup.started && setup.status !== null && !setup.status.completed && !setup.status.custom;
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
          if (e.payload.state === "stopped") setWarning(null);
          setCaptureNote(
            e.payload.state === "stopped" ? null : e.payload.note_id,
          );
          if (e.payload.error) fail(e.payload.error);
        },
      ),
      listen<{ source: string; level: number }>("capture://level", (e) =>
        setLevels((l) => ({ ...l, [e.payload.source]: e.payload.level })),
      ),
      listen<{note_id:string; kind:string; active:boolean}>("capture://warning", e => setWarning(e.payload)),
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
      // Always save the newest note, never a snapshot taken when the timer was set.
      void persist(current.current ?? next);
    }, 400);
  }

  async function select(n: Note) {
    setAgenda(false);
    await flush();
    setDirectory(null);
    setWorkspaceChat(false);
    setNote(n);
    setTemplate(n.template_id ?? "auto");
    setSegments(await data("segments", { id: n.id }));
  }
  async function create(firstRun = false) {
    await flush();
    const n = await data<Note>("start_note", {});
    if(firstRun) { n.title="Untitled meeting"; await data("update",n);setFirstRunNote(n.id); }
    setSetupChoice(true);
    await select(n);
    await refresh();
  }
  async function enhance() {
    if (!note) return;
    if (!setup.aiReady) { setProgress(setup.status?.ai === "skipped" ? "AI notes aren't set up on this computer." : setup.eta === "working out time left…" ? "AI notes unlock when the download finishes · working out time left…" : `AI notes will be ready in ${setup.eta.replace(/ left$/, "")}`); return; }
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
    const start = command === "start_capture";
    if (start && startPending.current) return;
    if (start) { startPending.current = true; setStarting(true); setError(""); setWarning(null); setLevels({}); }
    try {
      if (start && setup.status?.mic_checked === false) {
        const checked = await setup.checkMicrophone();
        if (checked !== "success") return;
      }
      await flush();
      await invoke(command, { noteId: note?.id });
      if (start) setNotice(await data<string>("notice"));
    } finally {
      if (start) { startPending.current = false; setStarting(false); }
    }
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
    <>
      {status !== "stopped" && <aside role="status" aria-label="Capture indicator">Capture {status}<button onClick={() => void invoke("stop_capture").catch(fail)}>Stop capture</button></aside>}
      {setup.quitRequested && <section role="dialog" aria-label="Setup isn't finished yet"><h2>Setup isn't finished yet</h2><p>If you quit now, the download pauses and carries on next time you open TalkKeeper.</p><button onClick={()=>setup.setQuitRequested(false)}>Keep TalkKeeper open</button><button onClick={()=>void setup.quit()}>Quit anyway</button><label><input type="checkbox" checked={setup.dontAsk} onChange={e=>setup.setDontAsk(e.target.checked)} />Don't ask again</label></section>}
      <CalendarAutoCapture active={status !== "stopped"} onOpen={async n => { await select(n); await refresh(); }} onError={fail} />
      <CalendarReminder onOpen={n => void select(n).then(refresh).catch(fail)} onError={fail} />
      {status !== "stopped" && <SnapshotControls noteId={captureNote} status={status} onError={fail} />}
    <main>
      <aside className="sidebar">
        <h1>TalkKeeper</h1>
        <button onClick={() => void flush().then(() => { setSetupChoice(true); setAgenda(true); setWorkspaceChat(false); setDirectory(null); }).catch(fail)}>Today &amp; upcoming</button>
        <button
          onClick={() =>
            void flush()
              .then(() => { setSetupChoice(true); setAgenda(false); setWorkspaceChat(true); })
              .catch(fail)
          }
        >
          Ask your notes
        </button>
        <button
          onClick={() => void create().catch(fail)}
        >
          New note
        </button>
        <input
          aria-label="Search notes"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() => {
            setSetupChoice(true);
            setDirectory(null);
            setTrash(false);
            setAgenda(false);
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
                  setSetupChoice(true);
                  setPersonId(undefined);
                  setDirectory(kind);
                  setAgenda(false);
                })
                .catch(fail)
            }
          >
            {kind === "people" ? "People" : "Companies"}
          </button>
        ))}
        <button onClick={() => { setSetupChoice(true); setAgenda(false); setDirectory(null); setTrash(true); }}>Trash</button>
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
                {!trash && <input type="checkbox" aria-label={`Select note ${n.title}`} checked={selectedNotes.includes(n.id)} onChange={(e) => setSelectedNotes((ids) => e.target.checked ? [...ids, n.id] : ids.filter((id) => id !== n.id))} />}
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
        <SetupCard setup={setup} systemAudio={systemAudio} showOffer={setupChoice} />
        <button
          onClick={() =>
            void data<Preferences>("settings").then(setSettings).catch(fail)
          }
        >
          Settings
        </button>
      </aside>
      <div className={`workspace${note?.id === firstRunNote ? " setup-first-note" : ""}`}>
        {error && (
          <div role="alert">
            {error}
            {error.toLowerCase().includes("microphone") && <MicrophoneSettingsButton onError={fail} />}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {progress && <p role="status">{progress}</p>}
        {setup.justCompleted && status === "stopped" && !saveTimer.current && <section role="status">
          {setup.status?.mic_checked ? <><h2>✓ TalkKeeper is fully set up</h2><p>Recording and AI notes both work, and everything stays on this computer.</p><button onClick={()=>void create().catch(fail)}>Start a note</button></> : <><p>AI notes are ready. One thing left: check your microphone.</p><button onClick={()=>void setup.checkMicrophone()}>Check my microphone</button></>}
          <button onClick={()=>setup.setJustCompleted(false)}>Dismiss</button>
        </section>}
        {settings && setup.speechReady && <button onClick={()=>void setup.checkMicrophone()}>Check my microphone</button>}
        {settings ? (
          <Settings
            initial={settings}
            onClose={() => {
              setSettings(null);
              void setup.refresh();
            }}
            onError={fail}
          />
        ) : setup.statusError && !setupChoice ? (
          <section role="alert"><p>TalkKeeper couldn't open its saved settings.</p><button onClick={() => void setup.refresh()}>Try again</button><button onClick={setup.startAnyway}>Start anyway</button></section>
        ) : setupNeeded ? (
          <Setup setup={setup} onStart={() => { setSetupChoice(true); void create(true).catch(fail); }} />
        ) : agenda ? (
          <Agenda onOpen={n => void select(n).then(refresh).catch(fail)} onError={fail} />
        ) : workspaceChat ? (
          !setup.aiReady ? <p role="status">Ask your notes will be ready when the AI model finishes downloading ({setup.eta}).</p> : <WorkspaceChat
            selected={selectedNotes}
            folders={folders}
            onOpen={(id, seq) => {
              setCitationSeq(seq);
              void data<Note>("get", { id })
                .then((n) => {
                  if (!n || n.deleted_at)
                    throw new Error("Source note is unavailable");
                  return select(n);
                })
                .catch(fail);
            }}
            onSaved={(n) => {
              void select(n).then(refresh).catch(fail);
            }}
          />
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
            <CalendarLink note={note} onError={fail} onOpen={n => void select(n).catch(fail)} />
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
              <CopyTranscript note={note} segments={segments} />
              <details>
                <summary>Export</summary>
                {[
                  ["summary", "Copy summary as Markdown"],
                  ["markdown", "Export Markdown"],
                  ["transcript", "Export transcript"],
                  ["csv", "Export CSV"],
                ].map(([format, label], i) => (
                  <button
                    key={label}
                    onClick={() => void exportNote(format, i < 1).catch(fail)}
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
              key={`attendees-${note.id}`}
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
              {!setup.speechReady && <p>Recording will be ready in about a minute. You can type notes now.</p>}
              {setup.speechReady && !setup.aiReady && <p>You can record now. AI notes will be written when the AI model finishes downloading.</p>}
              <p>Obtain participant consent before recording.</p>
              <CaptureFeedback systemAudio={systemAudio} warning={warning?.note_id === note.id && warning.active ? warning.kind : null} onError={fail} />
              <button
                disabled={!setup.speechReady || starting || status !== "stopped" || trash}
                onClick={() => void capture("start_capture").catch(fail)}
              >
                {starting ? "Starting…" : "Start capture"}
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
            <SnapshotGallery key={`snapshots-${note.id}`} noteId={note.id} onError={fail} onSeek={(ms) => {
              const segment = [...segments].reverse().find((s) => s.start_ms <= ms) ?? segments[0];
              if (segment) document.getElementById(`segment-${segment.seq}`)?.scrollIntoView?.({ behavior: "smooth" });
            }} />
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
                {setup.writingNote === note.id && <p role="status">Writing AI notes…</p>}
                {!setup.aiReady && <p role="status">{status === "stopped" && segments.length ? "Recording saved. AI notes for this meeting will be written automatically when the AI model is ready." : setup.paused ? "AI notes are waiting. The download is paused." : setup.status?.ai === "skipped" ? "AI notes aren't set up on this computer." : setup.eta === "working out time left…" ? "AI notes unlock when the download finishes · working out time left…" : `AI notes will be ready in ${setup.eta.replace(/ left$/, "")}`}</p>}
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
                    disabled={!setup.aiReady || enhancing || trash || !!note.summary_markdown}
                    onClick={() => void enhance()}
                  >
                    {enhancing
                      ? "Enhancing…"
                      : note.summary_markdown
                        ? "Use Redo notes below"
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
                onCopy={<CopyTranscript note={note} segments={segments} />}
              />
            </div>
            {setup.aiReady ? <Chat
              onSettings={() =>
                void data<Preferences>("settings").then(setSettings).catch(fail)
              }
              key={note.id}
              locked={enhancing}
              note={note}
              segments={segments}
              beforeRequest={flush}
              onNote={(n) => {
                if (current.current?.id !== n.id) return;
                current.current = n;
                setNote(n);
                void refresh().catch(fail);
              }}
            /> : <p>Available when the AI model finishes downloading.</p>}
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
    </>
  );
}
