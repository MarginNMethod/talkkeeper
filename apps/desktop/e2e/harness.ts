import { mockIPC } from "@tauri-apps/api/mocks";
let chat: Record<string, unknown>[] = [];
let versions: Record<string, unknown>[] = [];
let notes: Record<string, unknown>[] = [];
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
let setupAttempts = 0;
let dictationConfig: Record<string, unknown> | null = null;
let dictations: Record<string, unknown>[] = [];
const listeners: Record<string, number[]> = {};
let snapshots: Record<string, unknown>[] = [];
let screenEnabled = false;
let captureNote = "";
function emit(event: string, payload: unknown) {
  for (const handler of listeners[event] ?? [])
    (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, arg: unknown) => void } }).__TAURI_INTERNALS__.runCallback(handler, { event, id: 1, payload: structuredClone(payload) });
}
mockIPC(async (command, args) => {
  const a = args as Record<string, unknown>;
  if (command === "plugin:event|listen") {
    const event = a.event as string;
    (listeners[event] ??= []).push(a.handler as number);
    return 1;
  }
  if (command === "plugin:event|unlisten") return;
  if (command === "dictation_data") {
    const p = a.payload as Record<string, unknown>;
    if (a.action === "settings") return structuredClone(dictationConfig);
    if (a.action === "save") { dictationConfig = structuredClone(p); return; }
    if (a.action === "history") return structuredClone(dictations);
    if (a.action === "permissions") return { microphone: "Enable Microphone", paste: "Enable Accessibility in Privacy & Security", devices: ["Test mic"] };
  }
  if (command === "dictation_control") {
    for (const state of ["listening", "transcribing", "inserting"]) {
      for (const handler of listeners["dictation://state"] ?? [])
        (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, arg: unknown) => void } }).__TAURI_INTERNALS__.runCallback(handler, { event: "dictation://state", id: 1, payload: { state } });
    }
    dictations = [{ id: "dictation-1", text: "Plant herbs tomorrow.", created_at: new Date().toISOString() }];
    for (const handler of listeners["dictation://history"] ?? [])
      (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, arg: unknown) => void } }).__TAURI_INTERNALS__.runCallback(handler, { event: "dictation://history", id: 1, payload: { notice: "Automatic paste unavailable. Enable Accessibility in Privacy & Security; text remains on clipboard." } });
    return;
  }
  if (command === "setup_status")
    return { completed: setupDone, custom: false };
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
    if (
      new URLSearchParams(location.search).has("failure") &&
      setupAttempts++ === 0
    )
      throw new Error("Check your connection and retry.");
    for (const handler of listeners["setup://progress"] ?? [])
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            runCallback: (id: number, arg: unknown) => void;
          };
        }
      ).__TAURI_INTERNALS__.runCallback(handler, {
        event: "setup://progress",
        id: 1,
        payload: {
          stage: "PullModel",
          completed: 50,
          total: 100,
          percent: 50,
          message: "Downloading your AI model",
        },
      });

    if (new URLSearchParams(location.search).has("hold")) {
      await new Promise<void>((resolve) => {
        (window as unknown as { finishSetup: () => void }).finishSetup =
          resolve;
      });
    }
    setupDone = true;
    return;
  }
  if (command === "start_capture") { captureNote = String(a.noteId); emit("capture://state", { note_id: captureNote, state: "recording" }); return; }
  if (command === "snapshot_ai_status") return { supports_images: false, cloud: false, confirmed: true };
  if (command === "snapshot_control") {
    if (a.action === "status") return { enabled: screenEnabled };
    if (a.action === "sources") return [{ id: "window:2", name: "Slides window" }];
    if (a.action === "enable") {
      if (!a.confirmed) throw new Error("Confirm first");
      screenEnabled = true;
      snapshots = [{ id: "snapshot-1", note_id: captureNote, captured_at: new Date().toISOString(), elapsed_ms: 10000, source: "Slides window", use_in_summary: true }];
      emit("snapshots://changed", null); return true;
    }
    if (a.action === "disable") { screenEnabled = false; return; }
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
    switch (a.action) {
      case "snapshots": return structuredClone(snapshots.filter((s) => s.note_id === p.id));
      case "snapshot_image": return "data:image/jpeg;base64,/9j/2Q==";
      case "snapshot_exclude": snapshots = snapshots.map((s) => s.id === p.snapshot ? { ...s, use_in_summary: !p.excluded } : s); return;
      case "snapshot_delete": snapshots = snapshots.filter((s) => s.id !== p.snapshot); emit("snapshots://changed", null); return;
      case "snapshot_delete_all": snapshots = []; emit("snapshots://changed", null); return;
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
        return { provider: "Ollama" };
      case "speech_models":
        return [];
      case "list":
        return structuredClone(notes);
      case "templates":
        return [{ id: "auto", name: "Auto" }];
      case "folders":
        return [];
      case "segments":
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
          title: "Untitled conversation",
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
        notes = notes.map((n) => (n.id === p.id ? structuredClone(p) : n));
        return structuredClone(p);
      case "search":
        return structuredClone(
          notes
            .filter((n) => String(n.notes_markdown).includes(String(p.query)))
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
