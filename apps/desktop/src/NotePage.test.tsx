import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { AskBar, NoteHeader } from "./NotePage";
import { data, invoke, type Note } from "./api";
vi.mock("./api", () => ({
  data: vi.fn(async () => []),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
afterEach(() => {
  cleanup();
  vi.mocked(data).mockReset();
  vi.mocked(data).mockImplementation(async () => []);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});
const note: Note = {
  id: "n",
  title: "Planning",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  notes_doc: null,
  notes_markdown: "",
  summary_markdown: null,
  template_id: null,
  folder_id: null,
  attendees: [],
  deleted_at: null,
};
function header(overrides = {}) {
  const props = {
    note,
    folders: [{ id: "space", name: "Team" }],
    update: vi.fn(),
    recording: false,
    canEnhance: true,
    onEnhance: vi.fn(),
    onExport: vi.fn(),
    onRestore: vi.fn(),
    onTrash: vi.fn(),
    onPurge: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  render(<NoteHeader {...props} />);
  return props;
}
test("More menu preserves export, write up, trash and restore actions", () => {
  const props = header();
  expect(screen.queryByRole("button", { name: "Move to Trash" })).toBeNull();
  const more = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "More actions for this note" }),
    );
  more();
  fireEvent.click(screen.getByRole("button", { name: "Notes and summary" }));
  expect(props.onExport).toHaveBeenCalledWith("markdown", false);
  more();
  fireEvent.click(screen.getByRole("button", { name: "Write up my notes" }));
  expect(props.onEnhance).toHaveBeenCalledOnce();
  more();
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  expect(props.onTrash).toHaveBeenCalledOnce();
  cleanup();
  const deleted = header({ note: { ...note, deleted_at: "2026-01-02" } });
  more();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(deleted.onRestore).toHaveBeenCalledOnce();
  more();
  fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
  expect(deleted.onPurge).toHaveBeenCalledOnce();
});
test("metadata opens attendees and folder editing; recording protects trash", () => {
  const props = header({ recording: true });
  fireEvent.click(screen.getByRole("button", { name: /Add people/ }));
  expect(screen.getByLabelText("Who was there")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Folder"), {
    target: { value: "space" },
  });
  expect(props.update).toHaveBeenCalledWith({ folder_id: "space" });
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(
    screen.getByRole("button", { name: "More actions for this note" }),
  );
  expect(
    (screen.getByRole("button", { name: "Move to Trash" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
test("Ask bar opens the chat with the user's draft", () => {
  render(
    <AskBar>
      {(question) => (
        <section aria-label="Chat with this note">{question}</section>
      )}
    </AskBar>,
  );
  expect(screen.queryByRole("region")).toBeNull();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Ask about this note" }),
    { target: { value: "What did we decide?" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Ask about this note" }));
  expect(screen.getByRole("region").textContent).toBe("What did we decide?");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setupAppMocks(
  notesList: Note[],
  overrides: {
    segments?: (id: string) => Promise<unknown>;
    update?: (payload: unknown) => Promise<unknown>;
  } = {},
) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "setup_status")
      return { completed: true, custom: false, speech: "ready", ai: "ready", mic_checked: true };
    if (command === "setup_progress") return { progress: {}, running: false };
    if (command === "capture_status") return { note_id: null, state: "stopped", elapsed_ms: 0 };
    if (command === "capture_capabilities") return { system_audio: false };
    if (command === "snapshot_control") return { enabled: false };
    if (command === "list_input_devices") return [];
    if (command === "current_microphone") return "";
    return null;
  });
  vi.mocked(data).mockImplementation(async (action: string, payload?: unknown) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (action === "list") return notesList;
    if (action === "segments") return overrides.segments ? overrides.segments(String(p.id)) : [];
    if (action === "update") return overrides.update ? overrides.update(p) : p;
    if (action === "recorded_duration") return 0;
    if (action === "transcript_expiry") return null;
    if (action === "calendar_note") return null;
    return [];
  });
}

test("F3: opening a note shows loading status without stale note or mutating controls", async () => {
  const noteA = { ...note, id: "a", title: "Alpha meeting" };
  const noteB = { ...note, id: "b", title: "Beta meeting" };
  const segB = deferred<unknown>();
  setupAppMocks([noteA, noteB], {
    segments: (id) => (id === "b" ? segB.promise : Promise.resolve([])),
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Alpha meeting" }));
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "Note title" }) as HTMLTextAreaElement).value).toBe("Alpha meeting"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(await screen.findByRole("button", { name: "Beta meeting" }));
  await waitFor(() => {
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Opening note…");
  });
  expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull();
  expect(screen.queryByRole("button", { name: "More actions for this note" })).toBeNull();
  segB.resolve([]);
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "Note title" }) as HTMLTextAreaElement).value).toBe("Beta meeting"),
  );
});

test("F3 race: slow note A settling after fast note B does not overwrite note B", async () => {
  const noteA = { ...note, id: "a", title: "Slow Note A" };
  const noteB = { ...note, id: "b", title: "Fast Note B" };
  const segA = deferred<unknown>();
  setupAppMocks([noteA, noteB], {
    segments: (id) =>
      id === "a"
        ? segA.promise
        : Promise.resolve([
            { id: "sb", note_id: "b", seq: 1, start_ms: 0, speaker: "Me", text: "Fast B line" },
          ]),
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Slow Note A" }));
  await waitFor(() => expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(await screen.findByRole("button", { name: "Fast Note B" }));
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "Note title" }) as HTMLTextAreaElement).value).toBe("Fast Note B"),
  );
  segA.resolve([{ id: "sa", note_id: "a", seq: 1, start_ms: 0, speaker: "Me", text: "Stale A line" }]);
  await new Promise((r) => setTimeout(r, 20));
  expect((screen.getByRole("textbox", { name: "Note title" }) as HTMLTextAreaElement).value).toBe("Fast Note B");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("F4: note load failure shows plain-language error with Retry and Back to Home", async () => {
  const noteA = { ...note, id: "a", title: "Broken Note" };
  let calls = 0;
  setupAppMocks([noteA], {
    segments: async () => {
      calls += 1;
      if (calls === 1) throw new Error("SQLITE_BUSY: secret trace");
      return [];
    },
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Broken Note" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Couldn't open this note");
  expect(alert.textContent).toContain("Your saved notes haven't changed.");
  expect(alert.textContent).not.toContain("SQLITE_BUSY");
  expect(screen.getByRole("button", { name: "Back to Home" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "Note title" }) as HTMLTextAreaElement).value).toBe("Broken Note"),
  );
});

test("F5b: opening and reopening a non-empty note without input never calls update or shows save text or alert", async () => {
  const seeded = { ...note, id: "seeded", title: "Seeded note", notes_markdown: "A shared direction." };
  let updateCalls = 0;
  setupAppMocks([seeded], {
    update: () => {
      updateCalls += 1;
      return Promise.reject(new Error("save failed"));
    },
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Seeded note" }));
  await screen.findByRole("textbox", { name: "Note title" });
  await new Promise((r) => setTimeout(r, 1000));
  expect(updateCalls).toBe(0);
  expect(data).not.toHaveBeenCalledWith("update", expect.anything());
  expect(screen.queryByText(/Saving|Saved|couldn't be saved|Retry save/i)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(await screen.findByRole("button", { name: "Seeded note" }));
  await screen.findByRole("textbox", { name: "Note title" });
  await new Promise((r) => setTimeout(r, 1000));
  expect(updateCalls).toBe(0);
  expect(data).not.toHaveBeenCalledWith("update", expect.anything());
  expect(screen.queryByText(/Saving|Saved|couldn't be saved|Retry save/i)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
