import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CopyTranscript, formatTranscript } from "./CopyTranscript";
import { Chat } from "./Chat";
import { data, invoke, type Note, type Segment } from "./api";
const events = vi.hoisted(() => ({
  delta: undefined as
    undefined | ((e: { payload: { note_id: string; delta: string } }) => void),
}));
vi.mock("./api", () => ({ data: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_: string, fn: typeof events.delta) => {
    events.delta = fn;
    return Promise.resolve(() => {});
  }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const note = {
  id: "n",
  title: "Planning",
  created_at: "2026-01-02T10:00:00Z",
  summary_markdown: "Long notes",
  attendees: [],
  notes_markdown: "Rough notes",
} as unknown as Note;
const segments: Segment[] = [
  {
    id: "s",
    note_id: "n",
    seq: 12,
    start_ms: 65000,
    speaker: "Me",
    text: "Plant herbs Friday",
  },
];
test("copy formats timestamps, speakers, and text only", () => {
  expect(formatTranscript(note, segments)).toBe(
    "Planning · 2026-01-02\n[01:05] Me: Plant herbs Friday",
  );
  expect(formatTranscript(note, segments, false, false)).toBe(
    "Planning · 2026-01-02\nPlant herbs Friday",
  );
  expect(formatTranscript(note, segments, true, false)).toContain(
    "[01:05] Plant herbs Friday",
  );
});
test("copy variants announce success and clipboard failure exposes select all", async () => {
  vi.mocked(data).mockResolvedValue(null);
  render(<CopyTranscript note={note} segments={segments} />);
  fireEvent.change(screen.getByLabelText("Transcript format"), {
    target: { value: "text" },
  });
  fireEvent.click(screen.getByLabelText("Include speaker names"));
  fireEvent.click(screen.getByText("Copy transcript"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Copied 3 words"),
  );
  expect(data).toHaveBeenCalledWith("copy_text", {
    text: "Planning · 2026-01-02\nPlant herbs Friday",
  });
  vi.mocked(data).mockRejectedValueOnce(new Error("Clipboard unavailable"));
  fireEvent.click(screen.getByText("Copy transcript"));
  await waitFor(() =>
    expect(screen.getByLabelText("Transcript to copy")).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("Select all"));
  const area = screen.getByLabelText(
    "Transcript to copy",
  ) as HTMLTextAreaElement;
  expect(area.selectionEnd).toBe(area.value.length);
});
test("chat streams a proposal, applies explicitly, discards, restores and exposes citations", async () => {
  let applied = false,
    discarded = false;
  const proposal = {
    id: "a",
    role: "assistant",
    content: "Short notes [#12]",
    revision: "Short notes [#12]",
    proposed_edit_id: "edit",
  };
  vi.mocked(data).mockImplementation(async (action) => {
    if (action === "settings") return { provider: "OpenAI" };
    if (action === "chat_history")
      return discarded
        ? []
        : [
            applied
              ? { ...proposal, revision: null, proposed_edit_id: null }
              : proposal,
          ];
    if (action === "versions")
      return applied
        ? [{ id: "v", content: "Long notes", created_at: "today" }]
        : [];
    if (action === "apply_revision") {
      applied = true;
      return { ...note, summary_markdown: "Short notes [#12]" };
    }
    if (action === "discard_revision") {
      discarded = true;
      return note;
    }
    if (action === "restore_summary") return note;
    return null;
  });
  let finish: () => void = () => {};
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(proposal);
      }),
  );
  const onNote = vi.fn();
  render(
    <Chat
      note={note}
      segments={segments}
      beforeRequest={async () => {}}
      onNote={onNote}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText("Proposed revision")).toBeTruthy(),
  );
  expect(data).not.toHaveBeenCalledWith("apply_revision", expect.anything());
  expect(screen.getByText(/Cloud provider active/)).toBeTruthy();
  fireEvent.click(screen.getByText("Rewrite these notes shorter"));
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  events.delta?.({ payload: { note_id: "n", delta: "Streaming revision" } });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Streaming revision"),
  );
  finish();
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  fireEvent.click(screen.getByText("Apply", { exact: true }));
  await waitFor(() =>
    expect(onNote).toHaveBeenCalledWith(
      expect.objectContaining({ summary_markdown: "Short notes [#12]" }),
    ),
  );
  fireEvent.click(await screen.findByText("Source 12"));
  const link = screen.getByRole("link", { name: "[#12]" });
  expect(link.getAttribute("href")).toBe("#segment-12");
  fireEvent.click(link);
  fireEvent.click(screen.getByText("Undo"));
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("restore_summary", {
      id: "n",
      edit: "v",
    }),
  );
  cleanup();
  applied = false;
  render(
    <Chat
      note={note}
      segments={segments}
      beforeRequest={async () => {}}
      onNote={onNote}
    />,
  );
  fireEvent.click(await screen.findByText("Discard"));
  await waitFor(() =>
    expect(screen.queryByText("Proposed revision")).toBeNull(),
  );
});
