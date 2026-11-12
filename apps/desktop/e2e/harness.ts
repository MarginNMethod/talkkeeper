import { mockIPC } from "@tauri-apps/api/mocks";
let notes: Record<string, unknown>[] = [];
const firstRun = new URLSearchParams(location.search).has("setup");
let setupDone = !firstRun;
let setupAttempts = 0;
const listeners: Record<string, number[]> = {};
mockIPC(async (command, args) => {
  const a = args as Record<string, unknown>;
  if (command === "plugin:event|listen") {
    const event = a.event as string;
    (listeners[event] ??= []).push(a.handler as number);
    return 1;
  }
  if (command === "plugin:event|unlisten") return;
  if (command === "setup_status") return { completed: setupDone, custom: false };
  if (command === "setup_plan") return { llm: { friendly_name: "Compact conversation AI", approx_download_gb: 2.7, license: "Apache-2.0", notes: "Open model weights." }, whisper: { approx_download_mb: 78 }, total_download_bytes: 6.8e9, hardware: { os: "linux", total_ram_bytes: 8 * 2 ** 30, free_disk_bytes: 20e9 }, can_install: true };
  if (command === "setup_run") {
    if (new URLSearchParams(location.search).has("failure") && setupAttempts++ === 0) throw new Error("Check your connection and retry.");
    for (const handler of listeners["setup://progress"] ?? [])
      (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, arg: unknown) => void } }).__TAURI_INTERNALS__.runCallback(handler, { event: "setup://progress", id: 1, payload: { stage: "PullModel", completed: 50, total: 100, percent: 50, message: "Downloading your AI model" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    setupDone = true; return;
  }
  if (command === "enhance_note") {
    const text = "## Decisions\nProceed with the garden plan.";
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    await new Promise((resolve) => setTimeout(resolve, 200));
    notes[0].summary_markdown = text;
    return { text, citations: [] };
  }
  if (command === "data") {
    const p = a.payload as Record<string, unknown>;
    switch (a.action) {
      case "settings": return { provider: "Ollama" };
      case "speech_models": return [];
      case "list":
        return notes;
      case "templates":
        return [{ id: "auto", name: "Auto" }];
      case "folders":
      case "segments":
        return [];
      case "start_note": {
        const n = {
          id: "note-1",
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
        return n;
      }
      case "update":
        notes = notes.map((n) => (n.id === p.id ? p : n));
        return p;
      case "search":
        return notes
          .filter((n) => String(n.notes_markdown).includes(String(p.query)))
          .map((note) => ({ note, snippet: "garden plan" }));
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
