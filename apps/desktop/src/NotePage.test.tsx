import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AskBar, NoteHeader } from "./NotePage";
import type { Note } from "./api";
vi.mock("./api", () => ({
  data: vi.fn(async () => []),
  invoke: vi.fn(async () => null),
}));
afterEach(cleanup);
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
