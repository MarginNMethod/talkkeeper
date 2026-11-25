import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { data, invoke, type Note } from "./api";
vi.mock("./api", () => ({ data: vi.fn(async () => []), invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
afterEach(cleanup);
const COPY = "Changes couldn't be saved. Your draft is kept until you close Talkkeeper.";
const TRASH_COPY = "Couldn't move this note to Trash. It's still here, and your edits are kept.", PURGE_COPY = "Couldn't delete this note forever. It's still in Trash.";
const mk = (id: string, title: string, extra: Partial<Note> = {}): Note => ({ id, title, created_at: "2026-01-01", updated_at: "2026-01-01", notes_doc: null, notes_markdown: "", summary_markdown: null, template_id: null, folder_id: null, attendees: [], deleted_at: null, ...extra });
let db: Note[] = [], updates: Note[] = [], deletes = 0, deleteFails = false, holdDelete: (() => Promise<void>) | null = null;
let saveMode: "ok" | "fail" | (() => Promise<unknown>) = "ok";
function backend(notes: Note[]) {
  db = notes; updates = []; deletes = 0; saveMode = "ok"; deleteFails = false; holdDelete = null;
  const boot: Record<string, unknown> = { setup_status: { completed: true, custom: false, speech: "ready", ai: "ready", mic_checked: true }, setup_progress: { progress: {}, running: false }, capture_status: { note_id: null, state: "stopped", elapsed_ms: 0 }, capture_capabilities: { system_audio: false }, snapshot_control: { enabled: false }, list_input_devices: [], current_microphone: "" };
  vi.mocked(invoke).mockImplementation(async (c: string) => boot[c] ?? null);
  vi.mocked(data).mockImplementation(async (action: string, payload?: unknown) => {
    const p = (payload ?? {}) as Note, live = () => db.filter((n) => !n.deleted_at).map((n) => ({ ...n }));
    if (action === "list") return live();
    if (action === "trash") return db.filter((n) => n.deleted_at).map((n) => ({ ...n }));
    if (action === "folders") return [{ id: "f", name: "Team" }];
    if (action === "search") return live().map((note) => ({ note, snippet: "" }));
    if (action === "update") {
      updates.push({ ...p });
      if (saveMode === "fail") throw new Error("SQLITE_BUSY: raw trace");
      if (typeof saveMode === "function") await saveMode();
      db = db.map((n) => (n.id === p.id ? { ...p } : n));
      return p;
    }
    if ((action === "delete" || action === "purge") && holdDelete) await holdDelete();
    if ((action === "delete" || action === "purge") && deleteFails) throw new Error("delete failed");
    if (action === "delete") { deletes += 1; db = db.map((n) => (n.id === p.id ? { ...n, deleted_at: "2026-11-21" } : n)); }
    if (action === "purge") db = db.filter((n) => n.id !== p.id);
    return ["delete", "purge", "recorded_duration", "transcript_expiry", "calendar_note"].includes(action) ? null : [];
  });
}
const title = () => screen.getByRole("textbox", { name: "Note title" }) as HTMLTextAreaElement;
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const nav = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const edit = (value: string) => fireEvent.change(title(), { target: { value } });
const status = () => document.querySelector(".note-save-status")?.textContent ?? "";
const region = () => screen.queryByRole("region", { name: "Unsaved changes" });
const noFailure = () => { expect(screen.queryByText(COPY)).toBeNull(); expect(screen.queryAllByRole("alert")).toHaveLength(0); };
async function open(name: string, expected = name) {
  fireEvent.click(await screen.findByRole("button", { name }));
  await waitFor(() => expect(title().value).toBe(expected));
}
async function failOn(name: string, draft: string) { await open(name); edit(draft); await screen.findByText(COPY); }
const trashNote = () => { nav("More actions for this note"); nav("Move to Trash"); };
function reactClick(el: HTMLElement) { const k = Object.keys(el).find((x) => x.startsWith("__reactProps$")); if (k) (el as unknown as Record<string, { onClick?: () => void }>)[k].onClick?.(); }
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Doc body" }] }] };

test.each(["ok", "fail"] as const)("F1 lane rule 1: open with content, no input -> no write, no save status (saves %s)", async (mode) => {
  backend([mk("a", "Trailing", { notes_markdown: "Line one\n\n\n" }), mk("b", "Odd md", { notes_markdown: "* one\n+ two\n__bold__" }), mk("c", "Doc", { notes_markdown: "Doc body", notes_doc: doc })]);
  saveMode = mode; render(<App />);
  for (const name of ["Trailing", "Odd md", "Doc", "Trailing"]) {
    await open(name); await wait(1000); expect(updates).toHaveLength(0);
    expect(screen.queryByText(/Saving|Saved|couldn't be saved|Retry save/)).toBeNull();
    noFailure(); nav("Home"); expect(region()).toBeNull();
  }
  await open("Trailing"); edit("Trailing edited"); await waitFor(() => expect(updates).toHaveLength(1));
});

test("F2: title and Folder edits show Saving… then Saved, which then clears", async () => {
  backend([mk("a", "Alpha")]); let release = () => {}; saveMode = () => new Promise<void>((r) => (release = r)); render(<App />); await open("Alpha");
  expect(document.querySelector(".note-save-status")?.getAttribute("role")).toBe("status"); edit("Alpha 2");
  await waitFor(() => expect(status()).toBe("Saving…")); await waitFor(() => expect(updates).toHaveLength(1)); release();
  await waitFor(() => expect(status()).toBe("Saved")); await wait(2300); expect(status()).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /Add people/ })); fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "f" } });
  await waitFor(() => expect(status()).toBe("Saving…")); await waitFor(() => expect(updates).toHaveLength(2)); release();
  await waitFor(() => expect(status()).toBe("Saved")); expect(updates[1].folder_id).toBe("f");
});

test("F3/F4/D-R3: failure keeps draft with session-honest copy; Retry focuses title; reopen clears Saved; no Discard", async () => {
  backend([mk("a", "Alpha")]); saveMode = "fail"; render(<App />); await failOn("Alpha", "Alpha draft");
  const alert = screen.getByRole("alert"); expect(alert.textContent).toContain(COPY); expect(alert.textContent).not.toContain("SQLITE");
  expect(title().value).toBe("Alpha draft"); expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Discard/i })).toBeNull();
  nav("Retry save"); await waitFor(() => expect(updates).toHaveLength(2)); expect(updates[1].title).toBe("Alpha draft"); await screen.findByText(COPY);
  saveMode = "ok"; nav("Retry save"); await waitFor(() => expect(status()).toBe("Saved")); noFailure(); expect(db[0].title).toBe("Alpha draft");
  expect(document.activeElement).toBe(title()); nav("Home"); await wait(50); await open("Alpha draft"); expect(status()).toBe("");
  await wait(500); expect(updates).toHaveLength(3); noFailure();
});

test("F6 lane rule 2: leave and reopen twice keeps failure and draft until Retry succeeds; no row Discard", async () => {
  backend([mk("a", "Alpha")]); saveMode = "fail"; render(<App />); await failOn("Alpha", "Alpha draft"); nav("Home");
  await waitFor(() => expect(region()).not.toBeNull()); expect(region()!.textContent).toContain("1 note couldn't be saved");
  expect(region()!.textContent).toContain("Drafts are kept until you close Talkkeeper.");
  expect(within(region()!).getByText("Alpha draft")).toBeTruthy(); expect(within(region()!).queryByRole("button", { name: /Discard/i })).toBeNull();
  for (let i = 0; i < 2; i++) {
    await open("Alpha draft"); await screen.findByText(COPY); expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
    expect(status()).toBe(""); expect(region()).toBeNull(); await wait(500); expect(updates).toHaveLength(1);
    nav("Home"); await waitFor(() => expect(region()?.textContent).toContain("Alpha draft"));
  }
  await open("Alpha draft"); edit("Alpha draft 2"); nav("Home");
  await waitFor(() => expect(region()?.textContent).toContain("Alpha draft 2")); expect(updates).toHaveLength(2);
  fireEvent.click(within(region()!).getByRole("button", { name: /^Open note/ })); await waitFor(() => expect(title().value).toBe("Alpha draft 2"));
  await screen.findByText(COPY); saveMode = "ok"; nav("Retry save"); await waitFor(() => expect(status()).toBe("Saved"));
  noFailure(); expect(db[0].title).toBe("Alpha draft 2");
});

test("F7/F8 D3: failure landing while on B shows workspace alert everywhere; B saves; Open note restores A", async () => {
  backend([mk("a", "Alpha"), mk("b", "Beta")]); let rejectA = () => {};
  saveMode = () => new Promise((_, reject) => (rejectA = () => reject(new Error("busy")))); render(<App />); await open("Alpha"); edit("Alpha draft");
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  fireEvent.click(await within(screen.getByRole("dialog", { name: "Search" })).findByRole("button", { name: "Beta" }));
  await waitFor(() => expect(updates).toHaveLength(1)); expect(updates[0].id).toBe("a"); rejectA();
  await waitFor(() => expect(title().value).toBe("Beta")); await waitFor(() => expect(region()?.textContent).toContain("Alpha draft"));
  expect(screen.queryByText(COPY)).toBeNull();
  for (const view of ["Home", "All notes", "Today", "Trash", "Home"]) { nav(view); await wait(50); expect(region()?.textContent).toContain("Alpha draft"); }
  saveMode = "ok"; await open("Beta"); edit("Beta 2"); await waitFor(() => expect(status()).toBe("Saved")); expect(region()?.textContent).toContain("Alpha draft");
  edit("Beta 3"); fireEvent.click(within(region()!).getByRole("button", { name: /^Open note/ }));
  await waitFor(() => expect(title().value).toBe("Alpha draft")); expect(updates.at(-1)?.title).toBe("Beta 3");
  await screen.findByText(COPY); expect(region()).toBeNull();
});

test("F9: several failed notes are listed distinctly, collapse past 3, and Retry clears each independently", async () => {
  backend(["a", "b", "c", "d"].map((id) => mk(id, `Note ${id}`, { notes_markdown: `agenda ${id}` }))); saveMode = "fail"; render(<App />);
  for (const id of ["a", "b", "c", "d"]) { await failOn(`Note ${id}`, id < "c" ? "Sync" : `Sync ${id}`); nav("Home"); }
  await waitFor(() => expect(region()?.textContent).toContain("4 notes couldn't be saved"));
  expect(within(region()!).getAllByRole("listitem")).toHaveLength(3); nav("Show all 4 unsaved notes");
  const rows = within(region()!).getAllByRole("listitem").map((li) => li.textContent);
  expect(new Set(rows).size).toBe(4); expect(rows.filter((r) => r?.includes("agenda a"))).toHaveLength(1); nav("Show fewer");
  fireEvent.click(within(region()!).getAllByRole("button", { name: /^Open note/ })[0]); await screen.findByText(COPY);
  expect(region()?.textContent).toContain("3 notes couldn't be saved"); saveMode = "ok"; nav("Retry save");
  await waitFor(() => expect(status()).toBe("Saved")); expect(region()?.textContent).toContain("3 notes couldn't be saved");
});

test("F10/F11/F14-T3: rejected Trash keeps draft; Trash discards; Delete forever only on trashed note & drops late errors", async () => {
  backend([mk("a", "Alpha")]); saveMode = "fail"; render(<App />); await failOn("Alpha", "Alpha draft");
  nav("More actions for this note"); expect(screen.queryByRole("button", { name: "Delete forever" })).toBeNull();
  deleteFails = true; nav("Move to Trash"); await screen.findByText(TRASH_COPY); expect(screen.queryByText(/delete failed/)).toBeNull(); nav("Dismiss");
  expect(screen.getByText(COPY)).toBeTruthy(); expect(title().value).toBe("Alpha draft");
  deleteFails = false; trashNote(); await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull());
  await wait(600); expect(region()).toBeNull(); noFailure(); const saves = updates.length; nav("Trash"); await open("Alpha");
  expect(title().readOnly).toBe(true); expect(status()).toBe(""); noFailure(); expect(updates).toHaveLength(saves);
  nav("Home"); nav("Trash"); fireEvent.click(await screen.findByRole("button", { name: "Delete forever" })); nav("Confirm");
  await waitFor(() => expect(db).toHaveLength(0));
  for (const view of ["Trash", "Home"]) { nav(view); await wait(50); expect(region()).toBeNull(); expect(screen.queryByRole("button", { name: /Open note/ })).toBeNull(); }
});

test("F12: unmount clears debounce without saving or beforeunload; restart forgets session drafts", async () => {
  const listen = vi.spyOn(window, "addEventListener"); backend([mk("a", "Alpha")]); const first = render(<App />);
  await open("Alpha"); edit("Alpha typed"); first.unmount(); await wait(600); expect(updates).toHaveLength(0);
  saveMode = "fail"; const second = render(<App />); await failOn("Alpha", "Alpha draft"); second.unmount();
  render(<App />); await screen.findByRole("button", { name: "Alpha" }); expect(region()).toBeNull();
  expect(screen.queryByText(/draft/i)).toBeNull(); expect(listen.mock.calls.some(([t]) => t === "beforeunload")).toBe(false); listen.mockRestore();
});

test("F14-T1/F14-T2: Move to Trash disabled & guarded during held save; after settle trashes last saved; <400ms edit cancels", async () => {
  backend([mk("a", "Alpha"), mk("b", "Beta"), mk("c", "Gamma")]); saveMode = "fail"; render(<App />); await failOn("Alpha", "Alpha draft");
  let settle = () => {}; saveMode = () => new Promise<void>((r) => (settle = r)); nav("Retry save"); await waitFor(() => expect(status()).toBe("Saving…"));
  expect((screen.getByRole("button", { name: "Retry save" }) as HTMLButtonElement).disabled).toBe(true);
  nav("More actions for this note"); const trashBtn = screen.getByRole("button", { name: "Move to Trash" }) as HTMLButtonElement;
  expect(trashBtn.disabled).toBe(true); expect(trashBtn.title).toBe("");
  reactClick(trashBtn); fireEvent.keyDown(trashBtn, { key: "Enter" }); fireEvent.keyDown(trashBtn, { key: " " });
  await wait(50); expect(deletes).toBe(0); settle(); await waitFor(() => expect(status()).toBe("Saved"));
  expect(trashBtn.disabled).toBe(false); nav("Move to Trash"); await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull());
  expect(db.find((n) => n.id === "a")?.title).toBe("Alpha draft"); nav("Trash"); await open("Alpha draft"); expect(title().readOnly).toBe(true);
  nav("Home"); saveMode = "fail"; await failOn("Beta", "Beta draft");
  let rejectHeld: (e: Error) => void = () => {}; saveMode = () => new Promise<void>((_, j) => (rejectHeld = j));
  nav("Retry save"); await waitFor(() => expect(status()).toBe("Saving…")); const countBefore = updates.length;
  rejectHeld(new Error("busy")); await screen.findByText(COPY); trashNote();
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull());
  expect(updates).toHaveLength(countBefore); expect(db.find((n) => n.id === "b")?.title).toBe("Beta");
  nav("Trash"); await open("Beta"); expect(title().readOnly).toBe(true); noFailure();
  nav("Home"); saveMode = "ok"; await open("Gamma"); const preCount = updates.length; edit("Gamma quick"); trashNote();
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull()); await wait(500);
  expect(updates).toHaveLength(preCount); expect(db.find((n) => n.id === "c")?.title).toBe("Gamma");
});

test("F14-H1/H3/H2 (A3, A4): held Trash locks title, editor, folder, Retry; 0 writes; a <400ms edit is not saved; trashed = last saved", async () => {
  backend([mk("a", "Alpha"), mk("b", "Beta")]); render(<App />); await open("Alpha"); let release = () => {}; const hold = () => (holdDelete = () => new Promise<void>((r) => (release = r)));
  hold(); edit("Alpha quick"); trashNote(); await waitFor(() => expect(title().readOnly).toBe(true)); edit("typed during delete"); expect(title().value).toBe("Alpha quick"); expect(document.querySelector("[contenteditable]")?.getAttribute("contenteditable")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /Add people/ })); const folder = screen.getByLabelText("Folder") as HTMLSelectElement; expect(folder.closest("fieldset")!.disabled).toBe(true);
  fireEvent.change(folder, { target: { value: "f" } }); await wait(600); expect(updates).toHaveLength(0); expect(status()).toBe(""); release(); await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull());
  expect(db[0]).toMatchObject({ title: "Alpha", folder_id: null, deleted_at: "2026-11-21" }); noFailure(); saveMode = "fail"; await failOn("Beta", "Beta draft"); const n = updates.length; hold(); trashNote();
  await waitFor(() => expect((screen.getByRole("button", { name: "Retry save" }) as HTMLButtonElement).disabled).toBe(true)); const retry = screen.getByRole("button", { name: "Retry save" });
  reactClick(retry); fireEvent.click(retry); fireEvent.keyDown(retry, { key: "Enter" }); fireEvent.keyDown(retry, { key: " " }); await wait(100); expect(updates).toHaveLength(n);
  release(); await waitFor(() => expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull()); await wait(100);
  expect(db[1]).toMatchObject({ title: "Beta", deleted_at: "2026-11-21" }); expect(updates).toHaveLength(n); expect(region()).toBeNull(); noFailure();
});

test("F14-F1 (A5) + lane rules: failed Trash keeps the typed edit via the normal save path, honest copy; with saves failing the draft survives two reopens", async () => {
  backend([mk("a", "Alpha"), mk("b", "Beta")]); render(<App />); await open("Alpha"); deleteFails = true; edit("Alpha typed"); trashNote(); await screen.findByText(TRASH_COPY);
  expect(screen.queryByText(/Error:|delete failed/)).toBeNull(); expect(title().readOnly).toBe(false); await waitFor(() => expect(status()).toBe("Saved"));
  expect(updates.map((u) => u.title)).toEqual(["Alpha typed"]); expect(db[0].deleted_at).toBeNull(); nav("Dismiss"); nav("Home"); await open("Alpha typed"); await wait(500); expect(updates).toHaveLength(1); expect(status()).toBe("");
  saveMode = "fail"; edit("Alpha kept"); trashNote(); await screen.findByText(TRASH_COPY); await screen.findByText(COPY); nav("Dismiss");
  for (let i = 0; i < 2; i++) { nav("Home"); await waitFor(() => expect(region()?.textContent).toContain("Alpha kept")); await open("Alpha kept"); await screen.findByText(COPY); }
  expect(db[0]).toMatchObject({ title: "Alpha typed", deleted_at: null });
});

test("F14-F2/F3: failed Trash with a failed draft or no edit writes nothing and keeps state; held/failed Delete forever changes nothing", async () => {
  backend([mk("a", "Alpha"), mk("b", "Beta")]); saveMode = "fail"; render(<App />); await failOn("Alpha", "Alpha draft"); const n = updates.length;
  deleteFails = true; trashNote(); await screen.findByText(TRASH_COPY); nav("Dismiss"); await wait(500); expect(updates).toHaveLength(n); expect(screen.getByText(COPY)).toBeTruthy(); expect(title().value).toBe("Alpha draft");
  saveMode = "ok"; nav("Retry save"); await waitFor(() => expect(status()).toBe("Saved")); expect(db[0].title).toBe("Alpha draft"); nav("Home"); await open("Beta"); trashNote(); await screen.findByText(TRASH_COPY); nav("Dismiss"); await wait(500);
  expect(updates.filter((u) => u.id === "b")).toHaveLength(0); expect(status()).toBe(""); expect(db[1].deleted_at).toBeNull(); noFailure(); deleteFails = false; trashNote(); await waitFor(() => expect(db[1].deleted_at).not.toBeNull());
  let release = () => {}; holdDelete = () => new Promise<void>((r) => (release = r)); deleteFails = true; await wait(50); nav("Trash"); await wait(50); nav("Delete forever"); nav("Confirm");
  await wait(50); release(); await screen.findByText(PURGE_COPY); expect(screen.queryByText(/delete failed/)).toBeNull(); expect(db).toHaveLength(2); expect(region()).toBeNull();
});
