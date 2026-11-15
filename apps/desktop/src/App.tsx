import { SidebarIcon } from "./SidebarIcon";
import {
  Agenda,
  CalendarLink,
  CalendarReminder,
  CalendarAutoCapture,
} from "./Calendar";
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
import { RecordBar, RecordingElsewhere } from "./RecordBar";
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
    [warning, setWarning] = useState<{
      note_id: string;
      kind: string;
      active: boolean;
    } | null>(null),
    [captureNote, setCaptureNote] = useState<string | null>(null),
    [levels, setLevels] = useState<Record<string, number>>({}),
    [recordErrors, setRecordErrors] = useState<Record<string, string>>({}),
    [failedTakes, setFailedTakes] = useState<Record<string, number>>({}),
    [finishedNote, setFinishedNote] = useState<string | null>(null),
    [elapsed, setElapsed] = useState(0),
    [durations, setDurations] = useState<Record<string, number>>({}),
    [captureTitle, setCaptureTitle] = useState("another note"),
    [speechSize, setSpeechSize] = useState<string | undefined>(),
    [wordsAt, setWordsAt] = useState(0),
    [lag, setLag] = useState(0),
    [levelsAt, setLevelsAt] = useState(0),
    [dictating, setDictating] = useState(false),
    [expiry, setExpiry] = useState<{
      deleted_after?: number;
      expires?: string;
    } | null>(null),
    [autoStop, setAutoStop] = useState(false),
    [enhancing, setEnhancing] = useState(false),
    [folders, setFolders] = useState<{ id: string; name: string }[]>([]),
    [folder, setFolder] = useState(""),
    [download, setDownload] = useState<{
      percent: number;
      done: string;
      total: string;
      time: string;
    } | null>(null),
    [downloadReady, setDownloadReady] = useState(false),
    [progress, setProgress] = useState("");
  const [directory, setDirectory] = useState<"people" | "companies" | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState<"stop" | "purge" | null>(
    null,
  );
  const [folderEdit, setFolderEdit] = useState<{
    id: string;
    name: string;
    existing: boolean;
  } | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [directoryCounts, setDirectoryCounts] = useState({
    people: 0,
    companies: 0,
  });
  useEffect(() => {
    for (const kind of ["people", "companies"] as const)
      void data<unknown[]>(kind)
        .then((rows) =>
          setDirectoryCounts((c) => ({ ...c, [kind]: rows?.length ?? 0 })),
        )
        .catch(() => {});
  }, [notes]);
  function noteGroup(date: string) {
    const day = new Date(date),
      today = new Date();
    const age = Math.floor(
      (new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ).getTime() -
        new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) /
        86400000,
    );
    return age === 0
      ? "Today"
      : age === 1
        ? "Yesterday"
        : age < 7
          ? "Earlier this week"
          : day.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            });
  }
  const startPending = useRef(false);
  const captureRef = useRef<string | null>(null);
  const captureState = useRef("stopped");
  const restart = useRef(false);
  const clock = useRef({ elapsed: 0, at: Date.now() });
  const downloadStart = useRef(0);
  const downloadNote = useRef<string | null>(null);
  const visibleNote = useRef<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  useEffect(() => {
    void invoke<{ note_id: string | null; state: string; elapsed_ms: number }>(
      "capture_status",
    )
      .then((s) => {
        if (!s) return;
        captureRef.current = s.note_id;
        captureState.current = s.state;
        setCaptureNote(s.note_id);
        setStatus(s.state);
        clock.current = { elapsed: s.elapsed_ms, at: Date.now() };
        setElapsed(s.elapsed_ms);
      })
      .catch((e) => setRecordError(String(e)))
      .finally(() => setStatusLoaded(true));
    const timer = setInterval(() => {
      if (captureState.current === "recording")
        setElapsed(clock.current.elapsed + Date.now() - clock.current.at);
    }, 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (captureNote)
      void data<Note>("get", { id: captureNote })
        .then((n) => {
          if (n) setCaptureTitle(n.title);
        })
        .catch(() => {});
  }, [captureNote]);
  useEffect(() => {
    setLevels({});
    setLag(0);
    setAutoStop(false);
    setWarning(null);
    setDownload(null);
    setDownloadReady(false);
    setFinishedNote(null);
  }, [note?.id]);
  useEffect(() => {
    void invoke<{ system_audio: boolean }>("capture_capabilities")
      .then((c) => setSystemAudio(c.system_audio))
      .catch(fail);
  }, []);
  const [agenda, setAgenda] = useState(false);
  const [personId, setPersonId] = useState<string | undefined>();
  const [workspaceChat, setWorkspaceChat] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [citationSeq, setCitationSeq] = useState<number | null>(null);
  useEffect(() => {
    if (citationSeq !== null && !workspaceChat) {
      const target = document.getElementById(`segment-${citationSeq}`);
      if (target) {
        target.scrollIntoView?.({ behavior: "smooth" });
        setCitationSeq(null);
      }
    }
  }, [segments, workspaceChat, citationSeq]);
  const setup = useSetup();
  const [setupChoice, setSetupChoice] = useState(false);
  const [firstRunNote, setFirstRunNote] = useState<string | null>(null);
  useEffect(() => {
    if (!firstRunNote || note?.id !== firstRunNote) return;
    const focus = () => {
      const editor = document.querySelector<HTMLElement>(
        '[aria-label="Your notes"]',
      );
      if (editor) {
        editor.focus();
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(focus);
    observer.observe(document.body, { childList: true, subtree: true });
    const frame = requestAnimationFrame(focus);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [firstRunNote, note?.id]);
  const setupNeeded =
    !setupChoice &&
    !setup.started &&
    setup.status !== null &&
    !setup.status.completed &&
    !setup.status.custom;
  const current = useRef<Note | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveQueue = useRef(Promise.resolve());
  current.current = note;
  visibleNote.current =
    !settings && !agenda && !directory && !workspaceChat
      ? (note?.id ?? null)
      : null;
  const fail = (e: unknown) => setError(String(e));
  const recordError = recordErrors[note?.id ?? ""] ?? "";
  const setRecordError = (text: string, id = current.current?.id ?? "") =>
    setRecordErrors((errors) => ({ ...errors, [id]: text }));
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
        if (e.payload.note_id === captureRef.current) setWordsAt(Date.now());
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
      listen<{
        note_id: string;
        state: string;
        elapsed_ms?: number;
        error?: string;
      }>("capture://state", (e) => {
        const event = e.payload;
        const time =
          event.elapsed_ms ??
          clock.current.elapsed +
            (captureState.current === "recording"
              ? Date.now() - clock.current.at
              : 0);
        clock.current = { elapsed: time, at: Date.now() };
        setElapsed(time);
        captureState.current = event.state;
        captureRef.current = event.state === "stopped" ? null : event.note_id;
        setStatus(event.state);
        setCaptureNote(captureRef.current);
        if (event.state === "recording") setStarting(false);
        if (event.state === "stopped") {
          setWarning(null);
          setLevels({});
          setLag(0);
          setAutoStop(false);
          setDownload(null);
          setDownloadReady(false);
          setFinishedNote(event.note_id);
          setDurations((d) => ({
            ...d,
            [event.note_id]: (d[event.note_id] ?? 0) + time,
          }));
          if (event.error) {
            setRecordError(event.error, event.note_id);
            setFailedTakes((takes) => ({ ...takes, [event.note_id]: time }));
          }
          if (restart.current) {
            restart.current = false;
            void capture("start_capture", event.note_id);
          }
        }
      }),
      listen<{ note_id: string; source: string; level: number }>(
        "capture://level",
        (e) => {
          if (
            e.payload.note_id === visibleNote.current &&
            e.payload.note_id === captureRef.current &&
            captureState.current === "recording"
          ) {
            setLevels((l) => ({ ...l, [e.payload.source]: e.payload.level }));
            setLevelsAt(Date.now());
          }
        },
      ),
      listen<{ note_id: string; kind: string; active: boolean }>(
        "capture://warning",
        (e) => {
          if (e.payload.note_id === visibleNote.current) setWarning(e.payload);
        },
      ),
      listen<{ note_id: string; seconds: number }>("capture://lag", (e) => {
        if (e.payload.note_id === visibleNote.current)
          setLag(e.payload.seconds);
      }),
      listen<{ state: string }>("dictation://state", (e) =>
        setDictating(
          ["listening", "transcribing", "inserting"].includes(e.payload.state),
        ),
      ),
      listen<{ note_id: string }>("capture://auto-stop-suggested", (e) => {
        if (e.payload.note_id === visibleNote.current) setAutoStop(true);
      }),
      listen<{ downloaded: number; total: number }>("model://progress", (e) => {
        if (
          downloadNote.current !== visibleNote.current ||
          !downloadStart.current
        )
          return;
        const { downloaded, total } = e.payload;
        const remaining = downloaded
          ? (((Date.now() - downloadStart.current) / downloaded) *
              (total - downloaded)) /
            60000
          : 0;
        setDownload({
          percent: Math.round((downloaded / total) * 100),
          done: `${Math.round(downloaded / 1e6)} MB`,
          total: `${Math.round(total / 1e6)} MB`,
          time: `${Math.max(1, Math.round(remaining))} min`,
        });
      }),
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
    setSettings(null);
    setAgenda(false);
    await flush();
    setDirectory(null);
    setWorkspaceChat(false);
    const lines = await data<Segment[]>("segments", { id: n.id });
    setNote(n);
    setTemplate(n.template_id ?? "auto");
    setSegments(lines);
    setExpiry(null);
    void data<number>("recorded_duration", { id: n.id })
      .then((ms) => {
        if (typeof ms === "number") setDurations((d) => ({ ...d, [n.id]: ms }));
      })
      .catch(fail);
    void data<{ deleted_after?: number; expires?: string }>(
      "transcript_expiry",
      { id: n.id },
    )
      .then((value) => {
        if (current.current?.id === n.id) setExpiry(value);
      })
      .catch(fail);
  }
  async function create(firstRun = false) {
    await flush();
    const n = await data<Note>("start_note", {});
    if (firstRun || n.title === "Untitled conversation") {
      n.title = "Untitled meeting";
      await data("update", n);
      setFirstRunNote(n.id);
    }
    setSetupChoice(true);
    await select(n);
    await refresh();
  }
  async function enhance() {
    if (!note) return;
    if (!setup.aiReady) {
      setProgress(
        setup.status?.ai === "skipped"
          ? "AI notes aren't set up on this computer."
          : setup.eta === "working out time left…"
            ? "AI notes unlock when the download finishes · working out time left…"
            : `AI notes will be ready in ${setup.eta.replace(/ left$/, "")}`,
      );
      return;
    }
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
  async function capture(command: string, id = current.current?.id) {
    if (command === "cancel_download") {
      await invoke("cancel_model_download");
      downloadStart.current = 0;
      setDownload(null);
      return;
    }
    if (!id) return;
    if (command === "restart") {
      restart.current = true;
      command = "stop_capture";
    }
    const start = command === "start_capture";
    if (start && startPending.current) return;
    if (!start && id !== captureRef.current) return;
    if (start) {
      captureRef.current = id;
      captureState.current = "starting";
      setCaptureNote(id);
      startPending.current = true;
      setStarting(true);
      setRecordError("", id);
      setFailedTakes((takes) => {
        const next = { ...takes };
        delete next[id];
        return next;
      });
      setWarning(null);
      setLevels({});
      setElapsed(0);
      setWordsAt(0);
      setFinishedNote(null);
      clock.current = { elapsed: 0, at: Date.now() };
    }
    if (command === "stop_capture") setStatus("finishing");
    try {
      if (start && setup.status?.mic_checked === false) {
        const checked = await setup.checkMicrophone();
        if (checked !== "success") return;
      }
      await flush();
      await invoke(command, { noteId: id });
    } catch (e) {
      const text = String(e);
      if (
        /Download the selected|Choose an STT|Unknown local model|model verification/.test(
          text,
        )
      ) {
        void Promise.all([
          data<Preferences>("settings"),
          data<{ name: string; size: number }[]>("speech_models"),
        ])
          .then(([prefs, models]) => {
            const bytes = models?.find(
              (m) => m.name === prefs?.stt_model,
            )?.size;
            setSpeechSize(
              bytes
                ? bytes >= 1e9
                  ? `${(bytes / 1e9).toFixed(1)} GB`
                  : `${Math.round(bytes / 1e6)} MB`
                : undefined,
            );
          })
          .catch(() => {});
      }
      if (text.includes("Stop dictation")) setDictating(true);
      else if (text.includes("Capture already active")) {
        const s = await invoke<{
          note_id: string;
          state: string;
          elapsed_ms: number;
        }>("capture_status");
        captureRef.current = s.note_id;
        captureState.current = s.state;
        setCaptureNote(s.note_id);
        setStatus(s.state);
        clock.current = { elapsed: s.elapsed_ms, at: Date.now() };
        setElapsed(s.elapsed_ms);
      } else if (!text.includes("Recording cancelled"))
        setRecordError(text, id);
      if (start && !text.includes("Capture already active")) {
        captureRef.current = null;
        captureState.current = "stopped";
        setCaptureNote(null);
        setStatus("stopped");
      }
      restart.current = false;
    } finally {
      if (start) {
        startPending.current = false;
        setStarting(false);
      }
    }
  }
  async function downloadSpeech() {
    try {
      const prefs = await data<Preferences>("settings");
      if (!prefs.stt_model) {
        setSettings(prefs);
        return;
      }
      downloadNote.current = current.current?.id ?? null;
      downloadStart.current = Date.now();
      setDownload({ percent: 0, done: "0 MB", total: "…", time: "…" });
      await invoke("download_model", { name: prefs.stt_model });
      downloadStart.current = 0;
      if (downloadNote.current === visibleNote.current) {
        setDownload(null);
        setRecordError("");
        setDownloadReady(true);
        setTimeout(() => setDownloadReady(false), 6000);
      }
    } catch (e) {
      setDownload(null);
      if (!String(e).includes("Download cancelled")) setRecordError(String(e));
    }
  }
  function goToRecording() {
    if (captureNote)
      void data<Note>("get", { id: captureNote })
        .then((n) => {
          setSettings(null);
          return select(n);
        })
        .catch(fail);
  }
  const recordingTitle =
    notes.find((n) => n.id === captureNote)?.title ?? captureTitle;
  function stopOther() {
    setPendingAction("stop");
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
      <CalendarAutoCapture
        active={status !== "stopped"}
        onOpen={async (n) => {
          await select(n);
          await refresh();
        }}
        onError={(e) => setRecordError(String(e))}
      />
      <CalendarReminder
        onOpen={(n) => void select(n).then(refresh).catch(fail)}
        onError={fail}
      />
      {setup.quitRequested && (
        <section role="dialog" aria-label="Setup isn't finished yet">
          <h2>Setup isn't finished yet</h2>
          <p>
            If you quit now, the download pauses and carries on next time you
            open TalkKeeper.
          </p>
          <button onClick={() => setup.setQuitRequested(false)}>
            Keep TalkKeeper open
          </button>
          <button onClick={() => void setup.quit()}>Quit anyway</button>
          <label>
            <input
              type="checkbox"
              checked={setup.dontAsk}
              onChange={(e) => setup.setDontAsk(e.target.checked)}
            />
            Don't ask again
          </label>
        </section>
      )}
      {pendingAction && (
        <section
          role="alertdialog"
          aria-label={
            pendingAction === "stop"
              ? "Stop the recording?"
              : "Delete this note forever?"
          }
        >
          <h2>
            {pendingAction === "stop"
              ? `Stop the recording in "${recordingTitle}"?`
              : "Delete this note and transcript forever?"}
          </h2>
          <button
            onClick={() => {
              if (pendingAction === "stop")
                void capture("stop_capture", captureNote ?? undefined);
              else void mutate("purge").catch(fail);
              setPendingAction(null);
            }}
          >
            Confirm
          </button>
          <button onClick={() => setPendingAction(null)}>Cancel</button>
        </section>
      )}
      <main>
        <aside className="sidebar">
          <h1>TalkKeeper</h1>
          <button className="primary" onClick={() => void create().catch(fail)}>
            New note
          </button>
          <input
            aria-label="Search notes"
            placeholder="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav aria-label="Main">
            <ul>
              <li>
                <button
                  className="quiet"
                  aria-current={
                    !agenda &&
                    !workspaceChat &&
                    !directory &&
                    !trash &&
                    !settings
                      ? "page"
                      : undefined
                  }
                  onClick={() => {
                    setSettings(null);
                    setSetupChoice(true);
                    setDirectory(null);
                    setTrash(false);
                    setAgenda(false);
                    setWorkspaceChat(false);
                  }}
                >
                  <SidebarIcon name="Notes" />
                  Notes
                </button>
              </li>
              <li>
                <button
                  className="quiet"
                  aria-current={agenda && !settings ? "page" : undefined}
                  onClick={() =>
                    void flush()
                      .then(() => {
                        setSettings(null);
                        setSetupChoice(true);
                        setAgenda(true);
                        setWorkspaceChat(false);
                        setDirectory(null);
                      })
                      .catch(fail)
                  }
                >
                  <SidebarIcon name="Today" />
                  Today
                </button>
              </li>
              <li>
                <button
                  className="quiet"
                  aria-current={workspaceChat && !settings ? "page" : undefined}
                  onClick={() =>
                    void flush()
                      .then(() => {
                        setSettings(null);
                        setSetupChoice(true);
                        setAgenda(false);
                        setWorkspaceChat(true);
                        setDirectory(null);
                      })
                      .catch(fail)
                  }
                >
                  <SidebarIcon name="Ask your notes" />
                  Ask your notes
                </button>
              </li>
              {(["people", "companies"] as const)
                .filter(
                  (kind) =>
                    directoryCounts[kind] > 0 ||
                    (kind === "people" &&
                      notes.some((n) => n.attendees.length > 0)),
                )
                .map((kind) => (
                  <li key={kind}>
                    <button
                      className="quiet"
                      aria-current={
                        directory === kind && !settings ? "page" : undefined
                      }
                      onClick={() => {
                        void flush()
                          .then(() => {
                            setSettings(null);
                            setSetupChoice(true);
                            setPersonId(undefined);
                            setDirectory(kind);
                            setAgenda(false);
                            setWorkspaceChat(false);
                          })
                          .catch(fail);
                      }}
                    >
                      <SidebarIcon
                        name={kind === "people" ? "People" : "Companies"}
                      />
                      {kind === "people" ? "People" : "Companies"}
                    </button>
                  </li>
                ))}
            </ul>
          </nav>
          <div className="folder-heading">
            <h3>Folders</h3>
            <button
              className="quiet"
              aria-label="New folder"
              title="New folder"
              onClick={() =>
                setFolderEdit({
                  id: crypto.randomUUID(),
                  name: "",
                  existing: false,
                })
              }
            >
              +
            </button>
          </div>
          <button
            className="quiet"
            aria-pressed={!folder}
            onClick={() => setFolder("")}
          >
            All notes
          </button>
          {!folders.length && <small>Group notes into folders.</small>}
          {folders.map((f) => (
            <div className="folder-row" key={f.id}>
              <button
                className="quiet"
                aria-pressed={folder === f.id}
                onClick={() => setFolder(f.id)}
              >
                {f.name}
              </button>
              <details>
                <summary aria-label={`Folder options for ${f.name}`}>…</summary>
                <button onClick={() => setFolderEdit({ ...f, existing: true })}>
                  Rename
                </button>
                <button onClick={() => setDeleteFolder(f)}>
                  Delete folder…
                </button>
              </details>
            </div>
          ))}
          {folderEdit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!folderEdit.name.trim()) return;
                void data("save_folder", {
                  folder: {
                    id: folderEdit.id,
                    name: folderEdit.name.trim(),
                    parent_id: null,
                  },
                  update: folderEdit.existing,
                })
                  .then(() => data<typeof folders>("folders"))
                  .then(setFolders)
                  .then(() => setFolderEdit(null))
                  .catch(fail);
              }}
            >
              <input
                autoFocus
                aria-label="Folder name"
                value={folderEdit.name}
                onChange={(e) =>
                  setFolderEdit({ ...folderEdit, name: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") setFolderEdit(null);
                }}
              />
              <button type="submit">Apply</button>
              <button type="button" onClick={() => setFolderEdit(null)}>
                Cancel
              </button>
            </form>
          )}
          {deleteFolder && (
            <section
              role="alertdialog"
              aria-label={`Delete the folder "${deleteFolder.name}"?`}
            >
              <h3>Delete the folder "{deleteFolder.name}"?</h3>
              <p>The notes inside are kept and move to All notes.</p>
              <button
                onClick={() =>
                  void data("delete_folder", { id: deleteFolder.id })
                    .then(() => {
                      setFolder("");
                      setDeleteFolder(null);
                      return data<typeof folders>("folders");
                    })
                    .then(setFolders)
                    .then(refresh)
                    .catch(fail)
                }
              >
                Delete folder
              </button>
              <button onClick={() => setDeleteFolder(null)}>Cancel</button>
            </section>
          )}
          {query && (
            <div>
              <h3>Results for "{query}"</h3>
              <button className="quiet" onClick={() => setQuery("")}>
                Clear
              </button>
              {!notes.length && <p>No notes mention "{query}".</p>}
            </div>
          )}
          <div className="note-list">
            {notes
              .filter((n) => !folder || n.folder_id === folder)
              .map((n, i, a) => (
                <div key={n.id}>
                  {!query &&
                    (i === 0 ||
                      noteGroup(n.created_at) !==
                        noteGroup(a[i - 1].created_at)) && (
                      <h3>{noteGroup(n.created_at)}</h3>
                    )}
                  <button
                    className={note?.id === n.id ? "quiet active" : "quiet"}
                    onClick={() => void select(n).catch(fail)}
                  >
                    {n.title}
                    <small>
                      {snippets[n.id] ||
                        (captureNote === n.id
                          ? "● Recording"
                          : `${new Date(n.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · ${durations[n.id] ? `${Math.round(durations[n.id] / 60000)} min` : "no recording"}`)}
                    </small>
                  </button>
                </div>
              ))}
          </div>
          <button
            className="quiet"
            aria-current={
              trash && !settings && !agenda && !directory && !workspaceChat
                ? "page"
                : undefined
            }
            onClick={() => {
              setSettings(null);
              setSetupChoice(true);
              setAgenda(false);
              setWorkspaceChat(false);
              setDirectory(null);
              setTrash(true);
              setNote(null);
            }}
          >
            <SidebarIcon name="Trash" />
            Trash
          </button>
          <SetupCard
            setup={setup}
            systemAudio={systemAudio}
            showOffer={setupChoice}
          />
          <button
            className="quiet"
            aria-current={settings ? "page" : undefined}
            onClick={() =>
              void data<Preferences>("settings").then(setSettings).catch(fail)
            }
          >
            <SidebarIcon name="Settings" />
            Settings
          </button>
        </aside>
        <div
          className={`workspace${note?.id === firstRunNote ? " setup-first-note" : ""}`}
        >
          {captureNote && visibleNote.current !== captureNote && (
            <RecordingElsewhere
              title={recordingTitle}
              elapsed={elapsed}
              status={status}
              problem={
                recordErrors[captureNote]
                  ? "Recording needs attention"
                  : undefined
              }
              onGo={goToRecording}
              onStop={stopOther}
            />
          )}
          {error && (
            <div role="alert">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          {progress && <p role="status">{progress}</p>}
          {setup.justCompleted &&
            status === "stopped" &&
            !saveTimer.current && (
              <section role="status">
                {setup.status?.mic_checked ? (
                  <>
                    <h2>✓ TalkKeeper is fully set up</h2>
                    <p>
                      Recording and AI notes both work, and everything stays on
                      this computer.
                    </p>
                    <button onClick={() => void create().catch(fail)}>
                      Start a note
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      AI notes are ready. One thing left: check your microphone.
                    </p>
                    <button onClick={() => void setup.checkMicrophone()}>
                      Check my microphone
                    </button>
                  </>
                )}
                <button onClick={() => setup.setJustCompleted(false)}>
                  Dismiss
                </button>
              </section>
            )}
          {settings && setup.speechReady && (
            <button onClick={() => void setup.checkMicrophone()}>
              Check my microphone
            </button>
          )}
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
            <section role="alert">
              <p>TalkKeeper couldn't open its saved settings.</p>
              <button onClick={() => void setup.refresh()}>Try again</button>
              <button onClick={setup.startAnyway}>Start anyway</button>
            </section>
          ) : setupNeeded ? (
            <Setup
              setup={setup}
              onStart={() => {
                setSetupChoice(true);
                void create(true).catch(fail);
              }}
            />
          ) : agenda ? (
            <Agenda
              onOpen={(n) => void select(n).then(refresh).catch(fail)}
              onError={fail}
            />
          ) : workspaceChat ? (
            !setup.aiReady ? (
              <p role="status">
                Ask your notes will be ready when the AI model finishes
                downloading ({setup.eta}).
              </p>
            ) : (
              <WorkspaceChat
                selected={selectedNotes}
                onSelectedChange={setSelectedNotes}
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
            )
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
          ) : trash && !note ? (
            <section>
              <h2>Trash</h2>
              <p>
                Notes here can be restored. Nothing is deleted until you choose
                "Delete forever".
              </p>
              {!notes.length && <p>Trash is empty.</p>}
            </section>
          ) : note ? (
            <>
              {!setup.speechReady && (
                <p>
                  Recording will be ready in about a minute. You can type notes
                  now.
                </p>
              )}
              {setup.speechReady && !setup.aiReady && (
                <p>
                  You can record now. AI notes will be written when the AI model
                  finishes downloading.
                </p>
              )}
              <RecordBar
                key={`record-${note.id}`}
                state={
                  !statusLoaded || (starting && captureNote === note.id)
                    ? "starting"
                    : captureNote === note.id
                      ? status
                      : "stopped"
                }
                elapsed={
                  captureNote === note.id ||
                  finishedNote === note.id ||
                  (captureNote && captureNote !== note.id)
                    ? elapsed
                    : (durations[note.id] ?? 0)
                }
                hasTranscript={segments.length > 0}
                finished={finishedNote === note.id}
                systemAudio={systemAudio}
                speechSize={speechSize}
                lag={lag}
                levels={levels}
                levelsAt={levelsAt}
                warning={
                  warning?.note_id === note.id && warning.active
                    ? warning.kind
                    : null
                }
                silence={autoStop}
                error={recordError}
                errorEnded={failedTakes[note.id] !== undefined}
                errorElapsed={failedTakes[note.id]}
                otherTitle={
                  captureNote && captureNote !== note.id
                    ? recordingTitle
                    : undefined
                }
                trashed={!!note.deleted_at}
                dictating={dictating}
                speechReady={setup.speechReady}
                wordsAt={wordsAt}
                onCommand={(command) => void capture(command)}
                onSettings={() =>
                  void data<Preferences>("settings")
                    .then(setSettings)
                    .catch(fail)
                }
                onMicrophone={() =>
                  void invoke("open_microphone_settings").catch(() =>
                    data<Preferences>("settings").then(setSettings),
                  )
                }
                onDismissSilence={() => setAutoStop(false)}
                onRestore={() => void mutate("restore").catch(fail)}
                onGo={goToRecording}
                onStopOther={stopOther}
                onStopDictation={() =>
                  void invoke("dictation_control", { action: "stop" }).catch(
                    (e) => setRecordError(String(e)),
                  )
                }
                onCopyNotice={() =>
                  void data("copy_notice").catch((e) =>
                    setRecordError(String(e)),
                  )
                }
                onDownload={() => void downloadSpeech()}
                download={download}
                downloadReady={downloadReady}
                snapshots={
                  <SnapshotControls
                    noteId={note.id}
                    status={status}
                    onError={(e) => setRecordError(String(e))}
                  />
                }
              />
              <CalendarLink
                note={note}
                onError={fail}
                onOpen={(n) => void select(n).catch(fail)}
              />
              <header>
                <input
                  className="title"
                  aria-label="Note title"
                  value={note.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
                <details>
                  <summary>Export</summary>
                  {[
                    ["summary", "Copy summary"],
                    ["markdown", "Notes and summary"],
                    ["transcript", "Export transcript"],
                    [
                      "csv",
                      "Save a list of all notes as a spreadsheet file (.csv)",
                    ],
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
                        setPendingAction("purge");
                      }}
                    >
                      Delete forever
                    </button>
                  </>
                ) : (
                  <button
                    disabled={captureNote === note.id}
                    title={
                      captureNote === note.id
                        ? "Stop the recording before moving this note to the trash."
                        : undefined
                    }
                    onClick={() => void mutate("delete").catch(fail)}
                  >
                    Move to Trash
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
                Folder
                <select
                  value={note.folder_id ?? ""}
                  onChange={(e) =>
                    update({ folder_id: e.target.value || null })
                  }
                >
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <SnapshotGallery
                key={`snapshots-${note.id}`}
                noteId={note.id}
                onError={fail}
                onSeek={(ms) => {
                  const segment =
                    [...segments].reverse().find((s) => s.start_ms <= ms) ??
                    segments[0];
                  if (segment)
                    document
                      .getElementById(`segment-${segment.seq}`)
                      ?.scrollIntoView?.({ behavior: "smooth" });
                }}
              />
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
                  {setup.writingNote === note.id && (
                    <p role="status">Writing AI notes…</p>
                  )}
                  {!setup.aiReady && (
                    <p role="status">
                      {status === "stopped" && segments.length
                        ? "Recording saved. AI notes for this meeting will be written automatically when the AI model is ready."
                        : setup.paused
                          ? "AI notes are waiting. The download is paused."
                          : setup.status?.ai === "skipped"
                            ? "AI notes aren't set up on this computer."
                            : setup.eta === "working out time left…"
                              ? "AI notes unlock when the download finishes · working out time left…"
                              : `AI notes will be ready in ${setup.eta.replace(/ left$/, "")}`}
                    </p>
                  )}
                  <div className="summary-tools">
                    <label>
                      Summary style
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
                      disabled={
                        !setup.aiReady ||
                        enhancing ||
                        trash ||
                        !!note.summary_markdown
                      }
                      onClick={() => void enhance()}
                    >
                      {enhancing
                        ? "Writing…"
                        : note.summary_markdown
                          ? "Use Write it again below"
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
                    onChange={(e) =>
                      update({ summary_markdown: e.target.value })
                    }
                  />
                  <Summary
                    markdown={note.summary_markdown ?? ""}
                    segments={segments}
                  />
                </div>
                <Transcript
                  key={`transcript-${note.id}`}
                  expiry={expiry}
                  onSettings={() =>
                    void data<Preferences>("settings")
                      .then(setSettings)
                      .catch(fail)
                  }
                  state={
                    starting
                      ? "starting"
                      : captureNote === note.id
                        ? status
                        : "stopped"
                  }
                  finished={finishedNote === note.id}
                  noWords={finishedNote === note.id && !wordsAt}
                  elapsed={
                    captureNote === note.id || finishedNote === note.id
                      ? elapsed
                      : (durations[note.id] ?? 0)
                  }
                  systemAudio={systemAudio}
                  onRecord={() => void capture("start_capture")}
                  segments={segments}
                  onDelete={(ids) =>
                    void data("delete_segments", { id: note.id, ids })
                      .then(() =>
                        setSegments((s) =>
                          s.filter((x) => !ids.includes(x.id)),
                        ),
                      )
                      .catch(fail)
                  }
                  onCopy={<CopyTranscript note={note} segments={segments} />}
                />
              </div>
              {setup.aiReady ? (
                <Chat
                  onSettings={() =>
                    void data<Preferences>("settings")
                      .then(setSettings)
                      .catch(fail)
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
                />
              ) : (
                <p>Available when the AI model finishes downloading.</p>
              )}
            </>
          ) : (
            <section className="empty">
              <h2>A place to collect the conversation</h2>
              <p>
                Create a note to write, record, and find the details that
                matter.
              </p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
