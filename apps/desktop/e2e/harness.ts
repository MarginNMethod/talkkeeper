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
  if (command === "data") {
    const p = a.payload as Record<string, unknown>;
    switch (a.action) {
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
      case "settings":
        return { provider: "Ollama" };
      case "speech_models":
        return [];
      case "list":
        return structuredClone(notes);
      case "templates":
        return [{ id: "auto", name: "Auto" }];
      case "folders":
      case "segments":
        return [];
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
