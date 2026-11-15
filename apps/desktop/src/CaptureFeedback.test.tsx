import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CaptureFeedback } from "./CaptureFeedback";
import { App } from "./App";
import { data, invoke } from "./api";
const mocks = vi.hoisted(() => ({
  listeners: {} as Record<string, (e: { payload: unknown }) => void>,
}));
vi.mock("./api", () => ({ data: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, callback: (e: { payload: unknown }) => void) => {
      mocks.listeners[name] = callback;
      return () => {};
    },
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
test("silent microphone guidance opens settings and clears without routine feedback", async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const props = { systemAudio: false, warning: "mic_silent", onError: vi.fn() };
  const view = render(<CaptureFeedback {...props} />);
  expect(screen.getByRole("alert").textContent).toContain(
    "We can't hear anything",
  );
  fireEvent.click(screen.getByText("Choose microphone"));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("open_microphone_settings"),
  );
  view.rerender(<CaptureFeedback {...props} warning={null} />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.queryByText(/This build records your microphone only/),
  ).toBeNull();
  view.rerender(
    <CaptureFeedback {...props} systemAudio={true} warning={null} />,
  );
  expect(
    screen.queryByText(/This build records your microphone only/),
  ).toBeNull();
});
test("first recording requires consent and prevents double start until the command resolves", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "list_input_devices") return ["USB microphone"];
    if (command === "setup_status") return { completed: true, custom: false };
    if (command === "capture_capabilities") return { system_audio: false };
    if (command === "start_capture")
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    return null;
  });
  const note = {
    id: "note-1",
    title: "Test note",
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
  vi.mocked(data).mockImplementation(async (action) => {
    if (action === "start_note" || action === "get") return note;
    if (action === "notice") return "Consent";
    if (action === "settings") return {};
    if (action === "segments") return [];
    if (action === "calendar_note") return null;
    return [];
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "New note" }));
  fireEvent.click(await screen.findByRole("tab", {name:"Summary"}));
  expect(await screen.findAllByRole("button", {name:"Write up my notes"})).toHaveLength(1);
  expect(screen.queryByRole("button", {name:/Enhance|Redo/})).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Record" }));
  await screen.findByRole("dialog", {name:"Before you record"});
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "start_capture")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", {name:"Not yet"}));
  expect(screen.queryByRole("dialog", {name:"Before you record"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"Record"}));
  fireEvent.click(await screen.findByRole("button", {name:"Start recording"}));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("recording_preferences", {consent:true}));
  const pending = await screen.findByRole("button", { name: "Cancel" });
  expect((pending as HTMLButtonElement).disabled).toBe(false);
  await waitFor(() => expect(finish).toBeTruthy());
  fireEvent.click(pending);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stop_capture", { noteId: note.id }));
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "start_capture"),
  ).toHaveLength(1);
  await act(async () => {
    finish?.();
  });
  act(() =>
    mocks.listeners["capture://state"]({
      payload: { note_id: note.id, state: "recording" },
    }),
  );
  await screen.findByRole("button", { name: "Stop" });
  act(() =>
    mocks.listeners["capture://warning"]({
      payload: { note_id: note.id, kind: "mic_silent", active: true },
    }),
  );
  expect(screen.getByText(/We can.t hear anything/)).toBeTruthy();
  act(() =>
    mocks.listeners["capture://warning"]({
      payload: { note_id: note.id, kind: "mic_silent", active: false },
    }),
  );
  expect(screen.queryByText(/We can.t hear anything/)).toBeNull();
});
