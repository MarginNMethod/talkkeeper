const recordingPreferences = {
  recording_consent_confirmed: true,
  meeting_microphone: "",
};
let calendarAdded = new URLSearchParams(location.search).has("shell");
const mcpPreferences: Record<string, boolean> = {
  enabled: false,
  include_transcripts: false,
  include_calendar: false,
};
let mcpAccess = [{ timestamp: "2026-11-12T10:00:00Z", tool: "search_notes" }];
import { mockIPC } from "@tauri-apps/api/mocks";
let chat: Record<string, unknown>[] = [];
let versions: Record<string, unknown>[] = [];
const shellSeed = new URLSearchParams(location.search).has("shell");
let folders: {id: string; name: string}[] = shellSeed ? [{id:"space-1",name:"Product conversations"}] : [];
let notes: Record<string, unknown>[] = shellSeed ? ["Planning the next chapter", "A few ideas to follow up", "Weekly team conversation"].map((title,i) => ({ id: `seed-${i}`, title, created_at: new Date(Date.now()-i*86400000).toISOString(), updated_at: new Date().toISOString(), notes_markdown: ["A shared direction for the next release.", "Make room for a quieter, more useful workspace.", "Decisions, questions, and the next small steps."][i], notes_doc: null, summary_markdown: null, template_id: null, folder_id: i === 1 ? null : "space-1", attendees: i === 0 ? [{name:"Alex Rivera",email:"alex@example.test"}] : [], deleted_at: null })) : [];
let chats: Record<string, unknown>[] = [];
const recipes = [
  {
    id: "recipe-1",
    name: "Draft a follow-up message",
    description: "Draft agreed actions",
    prompt: "garden",
    default_scope: {
      note_ids: null,
      folder_id: null,
      date_from: null,
      date_to: null,
    },
  },
];
const firstRun = new URLSearchParams(location.search).has("setup");
let setupDone = !firstRun;
let speechReady = !firstRun;
let setupStarted = false;
let setupPaused = false;
let setupProgress: Record<string, unknown> = {};
let dictationConfig: Record<string, unknown> | null = null;
let dictations: Record<string, unknown>[] = [];
const listeners: Record<string, number[]> = {};
let snapshots: Record<string, unknown>[] = [];
let screenEnabled = false;
let captureNote = "";
let captureState = "stopped";
let captureStarted = 0;
let cancelStart: (() => void) | undefined;
const recordingTest = new URLSearchParams(location.search).has("recording");
const harnessParams = new URLSearchParams(location.search);
const hasSlowNote = harnessParams.has("slowNote");
const slowNoteId = harnessParams.get("slowNote") ?? "";
let noteFailsPending = harnessParams.has("noteFails");
let saveFailsPending = harnessParams.has("saveFails");
const saveFailsAlways = harnessParams.get("saveFails") === "always";
let saveAllowed = false;
window.addEventListener("mock:allow-save", () => { saveAllowed = true; });
const slowSave = harnessParams.has("slowSave");
const heldSaves: [() => void, (e: Error) => void][] = [];
const slowDelete = harnessParams.has("slowDelete"), deleteFails = harnessParams.has("deleteFails"), heldDeletes: (() => void)[] = [];
window.addEventListener("mock:resolve-delete", () => { for (const resolve of heldDeletes.splice(0)) resolve(); });
window.addEventListener("mock:resolve-save", () => { for (const [resolve] of heldSaves.splice(0)) resolve(); });
window.addEventListener("mock:reject-save", () => { for (const [, reject] of heldSaves.splice(0)) reject(new Error("Simulated save failure")); });
const noteReleaseQueue: (() => void)[] = [];
window.addEventListener("mock:release-note", () => {
  for (const release of noteReleaseQueue.splice(0)) release();
});
const recordingLines: Record<string, Record<string, unknown>[]> = {};
function emit(event: string, payload: unknown) {
  for (const handler of listeners[event] ?? [])
    (
      window as unknown as {
        __TAURI_INTERNALS__: {
          runCallback: (id: number, arg: unknown) => void;
        };
      }
    ).__TAURI_INTERNALS__.runCallback(handler, {
      event,
      id: 1,
      payload: structuredClone(payload),
    });
}
// Visual fixtures can deliver the same events as the native capture service.
window.addEventListener("mock:capture-warning", () => emit("capture://warning", {note_id: captureNote, kind: "mic_silent", active: true}));
mockIPC(async (command, args) => {
  const a = args as Record<string, unknown>;
  if (command === "plugin:event|listen") {
    const event = a.event as string;
    (listeners[event] ??= []).push(a.handler as number);
    return 1;
  }
  if (command === "plugin:event|unlisten") return;
  if (command === "mcp_data") {
    const p = a.payload as { key: string; value: boolean };
    if (a.action === "status")
      return structuredClone({
        preferences: mcpPreferences,
        executable: "/opt/TalkKeeper/talkkeeper-mcp",
        database: "/data/talkkeeper.sqlite",
      });
    if (a.action === "set") {
      mcpPreferences[p.key] = p.value;
      return;
    }
    if (a.action === "recent") return structuredClone(mcpAccess);
    if (a.action === "clear") {
      mcpAccess = [];
      return;
    }
    if (a.action === "check")
      return mcpPreferences.enabled
        ? "Ready. Notes can be read by connected tools."
        : "Turn on 'Let other AI apps read your notes' in TalkKeeper settings";
  }
  if (command === "dictation_data") {
    const p = a.payload as Record<string, unknown>;
    if (a.action === "settings") return structuredClone(dictationConfig);
    if (a.action === "save") {
      dictationConfig = structuredClone(p);
      return;
    }
    if (a.action === "history") return structuredClone(dictations);
    if (a.action === "permissions")
      return {
        microphone: "Enable Microphone",
        paste: "Enable Accessibility in Privacy & Security",
        devices: ["Test mic"],
      };
  }
  if (command === "dictation_control") {
    for (const state of ["listening", "transcribing", "inserting"]) {
      for (const handler of listeners["dictation://state"] ?? [])
        (
          window as unknown as {
            __TAURI_INTERNALS__: {
              runCallback: (id: number, arg: unknown) => void;
            };
          }
        ).__TAURI_INTERNALS__.runCallback(handler, {
          event: "dictation://state",
          id: 1,
          payload: { state },
        });
    }
    dictations = [
      {
        id: "dictation-1",
        text: "Plant herbs tomorrow.",
        created_at: new Date().toISOString(),
      },
    ];
    for (const handler of listeners["dictation://history"] ?? [])
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            runCallback: (id: number, arg: unknown) => void;
          };
        }
      ).__TAURI_INTERNALS__.runCallback(handler, {
        event: "dictation://history",
        id: 1,
        payload: {
          notice:
            "Automatic paste unavailable. Enable Accessibility in Privacy & Security; text remains on clipboard.",
        },
      });
    return;
  }
  if (command === "setup_status")
    return {
      notes: true,
      completed: setupDone,
      custom: false,
      pending: setupStarted,
      paused: setupPaused,
      speech: speechReady ? "ready" : "missing",
      ai: setupDone ? "ready" : "downloading",
    };
  if (command === "setup_progress")
    return { running: setupStarted && !setupDone, progress: setupProgress };
  if (command === "setup_cancel") {
    setupPaused = true;
    return;
  }
  if (command === "setup_test_provider") return [{ id: "test-model" }];
  if (command === "setup_check_microphone") return "success";
  if (command === "setup_mic_checked") return;
  if (command === "setup_plan")
    return {
      llm: {
        friendly_name: "Compact conversation AI",
        approx_download_gb: 2.7,
        license: "Apache-2.0",
        notes: "Open model weights.",
      },
      whisper: { approx_download_mb: 78 },
      total_download_bytes: 6.8e9,
      hardware: {
        os: "linux",
        total_ram_bytes: 8 * 2 ** 30,
        free_disk_bytes: 20e9,
      },
      can_install: true,
    };
  if (command === "setup_run") {
    setupStarted = true;
    setupPaused = false;
    const update = (
      stage: string,
      completed: number,
      total: number,
      message: string,
    ) => {
      const p = { stage, completed, total, message };
      setupProgress = { ...setupProgress, [stage]: p };
      emit("setup://progress", p);
    };
    update("DownloadSpeechModel", 39e6, 78e6, "Downloading speech");
    const controls = window as unknown as {
      readySpeech: () => void;
      finishSetup: () => void;
      offlineSetup: () => void;
    };
    controls.readySpeech = () => {
      speechReady = true;
      update("SpeechReady", 1, 1, "Recording is ready");
      emit("setup://unlocked", "speech");
      update("PullModel", 1.35e9, 2.7e9, "Downloading AI model");
    };
    controls.offlineSetup = () =>
      update(
        "Check",
        0,
        0,
        "Waiting for the internet. Your download is saved and will carry on by itself.",
      );
    if (new URLSearchParams(location.search).has("hold")) {
      await new Promise<void>((resolve) => {
        controls.finishSetup = resolve;
      });
    }
    controls.readySpeech();
    setupDone = true;
    update("Verify", 1, 1, "AI notes are ready");
    emit("setup://unlocked", "ai");
    return;
  }
  if (command === "calendar_data") {
    if (a.action === "add") calendarAdded = true;
    return { count: 1 };
  }
  if (command === "current_microphone") return recordingPreferences.meeting_microphone || "Built-in microphone";
  if (command === "diagnostics_report") return "TalkKeeper diagnostics: Built-in microphone";
  if (command === "list_input_devices")
    return ["Built-in microphone", "USB microphone"];
  if (command === "recording_preferences") {
    Object.assign(
      recordingPreferences,
      a.microphone !== undefined ? { meeting_microphone: a.microphone } : {},
      a.consent !== undefined ? { recording_consent_confirmed: a.consent } : {},
    );
    return;
  }
  if (command === "capture_status")
    return {
      note_id: captureNote || null,
      state: captureState,
      elapsed_ms: captureStarted ? Date.now() - captureStarted : 0,
    };
  if (["stop_capture", "pause_capture", "resume_capture"].includes(command)) {
    if (a.noteId !== captureNote)
      throw new Error("Recording belongs to another note");
    const cancelled = captureState === "starting";
    captureState =
      command === "stop_capture"
        ? "stopped"
        : command === "pause_capture"
          ? "paused"
          : "recording";
    emit("capture://state", {
      note_id: captureNote,
      state: captureState,
      elapsed_ms: Date.now() - captureStarted,
      cancelled,
    });
    if (captureState === "stopped") { captureNote = ""; cancelStart?.(); cancelStart = undefined; }
    return;
  }
  if (command === "capture_capabilities") return { system_audio: false };
  if (command === "open_microphone_settings") return;
  if (command === "start_capture") {
    captureNote = String(a.noteId);
    captureStarted = Date.now();
    if (new URLSearchParams(location.search).has("starting")) {
      captureState = "starting";
      emit("capture://state", { note_id: captureNote, state: "starting" });
      await new Promise<void>(resolve => { cancelStart = resolve; });
      throw new Error("Recording cancelled");
    }
    captureState = "recording";
    emit("capture://state", { note_id: captureNote, state: "recording" });
    if (recordingTest) {
      const id = captureNote;
      setTimeout(() => {
        if (captureState !== "recording" || captureNote !== id) return;
        const line = {
          id: `line-${id}`,
          note_id: id,
          seq: 1,
          start_ms: 0,
          speaker: "Me",
          text: "Planning together.",
        };
        recordingLines[id] = [line];
        emit("transcript://segment", line);
      }, 150);
    }
    return;
  }
  if (command === "snapshot_ai_status")
    return { supports_images: false, cloud: false, confirmed: true };
  if (command === "snapshot_control") {
    if (a.action === "status") return { enabled: screenEnabled };
    if (a.action === "sources")
      return [{ id: "window:2", name: "Slides window" }];
    if (a.action === "enable") {
      if (!a.confirmed) throw new Error("Confirm first");
      screenEnabled = true;
      snapshots = [
        {
          id: "snapshot-1",
          note_id: captureNote,
          captured_at: new Date().toISOString(),
          elapsed_ms: 10000,
          source: "Slides window",
          use_in_summary: true,
        },
      ];
      emit("snapshots://changed", null);
      return true;
    }
    if (a.action === "disable") {
      screenEnabled = false;
      return;
    }
    return false;
  }
  if (command === "chat_note") {
    const message = {
      id: "chat-1",
      role: "assistant",
      content: "Garden plan [#12]",
      revision: "Garden plan [#12]",
      proposed_edit_id: "edit-1",
    };
    for (const handler of listeners["chat://delta"] ?? [])
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            runCallback: (id: number, arg: unknown) => void;
          };
        }
      ).__TAURI_INTERNALS__.runCallback(handler, {
        event: "chat://delta",
        id: 1,
        payload: { note_id: a.noteId, delta: message.content },
      });
    chat.push(message);
    return message;
  }
  if (command === "enhance_note") {
    const text = "## Decisions\nProceed with the garden plan.";

    for (const handler of listeners["enhance://delta"] ?? [])
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            runCallback: (id: number, arg: unknown) => void;
          };
        }
      ).__TAURI_INTERNALS__.runCallback(handler, {
        event: "enhance://delta",
        id: 1,
        payload: { note_id: a.noteId, delta: text },
      });

    notes[0].summary_markdown = text;
    return { text, citations: [] };
  }
  if (command === "ask_workspace") {
    const chat = chats.find((c) => c.id === a.chatId)!;
    const sources = notes.slice(0, 2).map((n) => ({
      note_id: n.id,
      title: n.title,
      seq: 1,
      start_ms: 90000,
      text: "garden approved",
    }));
    const text = "Garden approved [S1]";
    for (const handler of listeners["workspace://delta"] ?? [])
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            runCallback: (id: number, arg: unknown) => void;
          };
        }
      ).__TAURI_INTERNALS__.runCallback(handler, {
        event: "workspace://delta",
        id: 1,
        payload: { chat_id: chat.id, delta: text },
      });
    chat.messages = [
      {
        role: "assistant",
        text,
        retrieval: { notes_searched: 2, segments_searched: 2, sources },
      },
    ];
    return structuredClone(chat);
  }
  if (command === "data") {
    const p = a.payload as Record<string, unknown>;
    const calendarEvent = {
      source_id: "source",
      uid: "meeting",
      instance_start: new Date().toISOString(),
      instance_end: new Date(Date.now() + 3600000).toISOString(),
      all_day: false,
      title: "Calendar planning",
      attendees: [{ name: "Alex", email: "alex@example.test" }],
      meeting_url: null,
    };
    switch (a.action) {
      case "calendar_sources":
        return [];
      case "calendar_events":
        return calendarAdded
          ? structuredClone([{ event: calendarEvent, note_id: null }, ...(shellSeed ? [{ event: {...calendarEvent, uid: "tomorrow", title: "Design check-in", instance_start: new Date(Date.now() + 86400000).toISOString(), instance_end: new Date(Date.now() + 90000000).toISOString()}, note_id: null }] : [])])
          : [];
      case "calendar_note":
        return notes.find((n) => n.id === p.id)?.title === "Calendar planning"
          ? structuredClone(calendarEvent)
          : null;
      case "calendar_start": {
        const existing = notes.find((n) => n.title === "Calendar planning");
        if (existing) return structuredClone(existing);
        const note = {
          id: `note-${notes.length + 1}`,
          title: "Calendar planning",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          notes_doc: null,
          notes_markdown: "",
          summary_markdown: null,
          template_id: null,
          folder_id: null,
          attendees: calendarEvent.attendees,
          deleted_at: null,
        };
        notes.push(structuredClone(note));
        return structuredClone(note);
      }
      case "snapshots":
        return structuredClone(snapshots.filter((s) => s.note_id === p.id));
      case "snapshot_image":
        return "data:image/jpeg;base64,/9j/2Q==";
      case "snapshot_exclude":
        snapshots = snapshots.map((s) =>
          s.id === p.snapshot ? { ...s, use_in_summary: !p.excluded } : s,
        );
        return;
      case "snapshot_delete":
        snapshots = snapshots.filter((s) => s.id !== p.snapshot);
        emit("snapshots://changed", null);
        return;
      case "snapshot_delete_all":
        snapshots = [];
        emit("snapshots://changed", null);
        return;
      case "people":
        return structuredClone(
          notes
            .flatMap((n) =>
              (n.attendees as { name: string; email: string }[]).map(
                (person) => ({
                  ...person,
                  id: person.email || person.name,
                  company_id: null,
                  manually_edited: false,
                }),
              ),
            )
            .filter(
              (p, i, all) => all.findIndex((other) => other.id === p.id) === i,
            ),
        );
      case "companies":
      case "duplicates":
        return [];
      case "person_meetings":
        return structuredClone(
          notes.filter((n) =>
            (n.attendees as { name: string; email: string }[]).some(
              (person) => (person.email || person.name) === p.id,
            ),
          ),
        );
      case "workspace_chats":
        return structuredClone(chats);
      case "recipes":
        return structuredClone(recipes);
      case "save_workspace_chat":
        chats = [structuredClone(p), ...chats.filter((c) => c.id !== p.id)];
        return structuredClone(p);
      case "delete_workspace_chat":
        chats = chats.filter((c) => c.id !== p.id);
        return;
      case "get":
        return structuredClone(notes.find((n) => n.id === p.id));
      case "save_workspace_result": {
        const chat = chats.find((c) => c.id === p.id)!;
        const n = {
          ...structuredClone(notes[0]),
          id: `note-${notes.length + 1}`,
          title: "Recipe result",
          notes_doc: null,
          notes_markdown: (chat.messages as { text: string }[])[0].text,
        };
        notes.push(n);
        return structuredClone(n);
      }
      case "chat_history":
        return structuredClone(chat);
      case "versions":
        return structuredClone(versions);
      case "copy_text":
        (window as unknown as { copiedText: string }).copiedText = String(
          p.text,
        );
        return null;
      case "apply_revision":
        versions.unshift({
          id: "version-1",
          content: notes[0].summary_markdown,
          created_at: new Date().toISOString(),
        });
        notes[0].summary_markdown = "Garden plan [#12]";
        chat = chat.map((m) => ({
          ...m,
          revision: null,
          proposed_edit_id: null,
        }));
        return { ...notes[0] };
      case "discard_revision":
        chat = [];
        return { ...notes[0] };
      case "restore_summary":
        notes[0].summary_markdown = versions[0].content;
        return { ...notes[0] };
      case "clear_chat":
        chat = [];
        return null;
      case "settings":
        return { provider: "Ollama", ...recordingPreferences };
      case "speech_models":
        return [];
      case "list":
        return structuredClone(notes.filter(n => !n.deleted_at));
      case "trash":
        return structuredClone(notes.filter(n => n.deleted_at));
      case "delete":
        if (slowDelete) await new Promise<void>((resolve) => heldDeletes.push(resolve));
        if (deleteFails) throw new Error("Simulated delete failure");
        notes = notes.map(n => n.id === p.id ? {...n, deleted_at: new Date().toISOString()} : n);
        return null;
      case "restore":
        notes = notes.map(n => n.id === p.id ? {...n, deleted_at: null} : n);
        return null;
      case "purge":
        if (slowDelete) await new Promise<void>((resolve) => heldDeletes.push(resolve));
        notes = notes.filter(n => n.id !== p.id);
        return null;
      case "templates":
        return [{ id: "auto", name: "Auto" }];
      case "folders":
        return structuredClone(folders);
      case "save_folder": {
        const folder = p.folder as {id: string; name: string};
        folders = p.update ? folders.map(f => f.id === folder.id ? folder : f) : [...folders,folder];
        return;
      }
      case "delete_folder":
        folders = folders.filter(f => f.id !== p.id);
        notes = notes.map(n => n.folder_id === p.id ? {...n,folder_id:null} : n);
        return;
      case "segments":
        if (hasSlowNote && (!slowNoteId || String(p.id) === slowNoteId))
          await new Promise<void>((resolve) => noteReleaseQueue.push(resolve));
        if (noteFailsPending) {
          noteFailsPending = false;
          throw new Error("Simulated note load failure");
        }
        if (recordingTest)
          return structuredClone(recordingLines[String(p.id)] ?? []);
        if (new URLSearchParams(location.search).has("setup")) return [];
        return [
          {
            id: "s1",
            note_id: p.id,
            seq: 1,
            start_ms: 90000,
            speaker: "Me",
            text: "garden approved",
          },
          {
            id: "seg-12",
            note_id: "note-1",
            seq: 12,
            start_ms: 65000,
            speaker: "Me",
            text: "Proceed with the garden plan.",
          },
        ];
      case "start_note": {
        const n = {
          id: `note-${notes.length + 1}`,
          title: "Untitled meeting",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          notes_markdown: "",
          notes_doc: null,
          summary_markdown: null,
          template_id: null,
          folder_id: null,
          attendees: [],
          deleted_at: null,
        };
        notes.push(n);
        return structuredClone(n);
      }
      case "update":
        if (slowSave) await new Promise<void>((resolve, reject) => heldSaves.push([resolve, reject]));
        if (saveFailsAlways && !saveAllowed) throw new Error("Simulated save failure");
        if (saveFailsPending && !saveFailsAlways) {
          saveFailsPending = false;
          throw new Error("Simulated save failure");
        }
        notes = notes.map((n) => (n.id === p.id ? structuredClone(p) : n));
        return structuredClone(p);
      case "search":
        return structuredClone(
          notes
            .filter((n) => `${n.title} ${n.notes_markdown}`.toLowerCase().includes(String(p.query).toLowerCase()))
            .map((note) => ({ note, snippet: "garden plan" })),
        );
      case "export":
        (window as unknown as { exported: string }).exported = String(
          notes[0].summary_markdown,
        );
        return "Markdown exported";
    }
  }
  return null;
});
await import("../src/main");
