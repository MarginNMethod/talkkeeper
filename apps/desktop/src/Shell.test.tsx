import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Home } from "./Home";
import { NotesList, noteGroup } from "./NotesList";
import { SpacePage } from "./SpacePage";
import { SearchPalette } from "./SearchPalette";
import { Sidebar } from "./Sidebar";
import { data, type Note } from "./api";
vi.mock("./api", () => ({ data: vi.fn().mockResolvedValue([]), invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const note = (id: string, days = 0): Note => ({
  id, title: id, created_at: new Date(Date.now() - days * 86400000).toISOString(),
  updated_at: new Date().toISOString(), notes_markdown: "A useful detail", notes_doc: null,
  summary_markdown: null, folder_id: "space", template_id: null, attendees: [], deleted_at: null,
});
test("local day labels include weekdays and keep distinct older days", () => {
  const now = new Date(2026, 10, 15, 12);
  expect(noteGroup(new Date(2026, 10, 15).toISOString(), now)).toBe("Today");
  expect(noteGroup(new Date(2026, 10, 14).toISOString(), now)).toBe("Yesterday");
  expect(noteGroup(new Date(2026, 10, 13).toISOString(), now)).toBe("Friday");
  expect(noteGroup(new Date(2026, 9, 1).toISOString(), now)).not.toBe(noteGroup(new Date(2026, 9, 2).toISOString(), now));
});
test("note rows sort by day, show fallback title and metadata, and open", () => {
  const open = vi.fn(), untitled = { ...note("empty"), title: "" };
  render(<NotesList notes={[note("older", 1), untitled]} onOpen={open} />);
  expect(screen.getAllByRole("heading").map(h => h.textContent)).toEqual(["Today", "Yesterday"]);
  fireEvent.click(screen.getByRole("button", { name: "Untitled note" }));
  expect(open).toHaveBeenCalledWith(untitled);
  expect(screen.getAllByText("A useful detail")).toHaveLength(2);
});
test("Home shares calendar loading, shows empty state and passes trimmed question", async () => {
  const ask = vi.fn();
  render(<Home notes={[]} onOpen={vi.fn()} onError={vi.fn()} onSettings={vi.fn()} onAsk={ask} />);
  expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
  expect(screen.getByText("No events today")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Ask anything" }), { target: { value: "  Next steps?  " } });
  fireEvent.submit(screen.getByRole("textbox", { name: "Ask anything" }).closest("form")!);
  expect(ask).toHaveBeenCalledWith("Next steps?");
  await waitFor(() => expect(data).toHaveBeenCalledWith("calendar_events"));
});
test("Space page uses the shared day list", () => {
  render(<SpacePage name="Research" notes={[note("Interview")]} onOpen={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Research" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Today notes" })).toBeTruthy();
});
test("search ignores stale results and restores focus on Escape", async () => {
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  let resolveOld!: (value: unknown) => void;
  vi.mocked(data).mockImplementation((_action, payload) => (payload as {query:string}).query === "old"
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve([{ note: note("new"), snippet: "match" }]));
  const close = vi.fn(), open = vi.fn();
  const view = render(<SearchPalette onClose={close} onOpen={open} onError={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "Search notes" });
  fireEvent.change(input, { target: { value: "old" } });
  fireEvent.change(input, { target: { value: "new" } });
  await screen.findByRole("button", { name: "new match" });
  resolveOld([{ note: note("stale"), snippet: "old" }]);
  await waitFor(() => expect(screen.queryByText("stale")).toBeNull());
  fireEvent.submit(input.closest("form")!); expect(open).toHaveBeenCalledWith(expect.objectContaining({id:"new"}));
  fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalled();
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
  vi.mocked(data).mockResolvedValue([]);
});
test("sidebar exposes current space and folder menu with exact name", () => {
  render(<Sidebar view={{kind:"space",folder:"space"}} onNavigate={vi.fn()} folders={[{id:"space",name:"Research"}]} setFolders={vi.fn()} counts={{people:0,companies:0}} onError={vi.fn()} refresh={vi.fn()}>{null}</Sidebar>);
  expect(screen.getByRole("button", {name:"Research"}).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("button", {name:"Folder options for Research"}));
  expect(screen.getByRole("button", {name:"Rename"})).toBeTruthy();
  expect(screen.queryByRole("textbox", {name:"Search notes"})).toBeNull();
});
test("Home lists upcoming calendar events and opens their linked notes", async () => {
  const event = {source_id:"calendar",uid:"event",title:"Team planning",instance_start:new Date().toISOString(),instance_end:new Date(Date.now()+3600000).toISOString(),all_day:false,attendees:[],meeting_url:null};
  vi.mocked(data).mockImplementation(action => Promise.resolve(action === "calendar_events" ? [{event,note_id:"linked"}] : note("linked")));
  const open = vi.fn();
  render(<Home notes={[note("Meeting")]} onOpen={open} onError={vi.fn()} onSettings={vi.fn()} onAsk={vi.fn()} />);
  await screen.findByText("Team planning");
  expect(screen.getByRole("heading",{level:1}).textContent).toBe("Coming up");
  fireEvent.click(screen.getByRole("button",{name:"Open linked note"}));
  await waitFor(() => expect(open).toHaveBeenCalledWith(expect.objectContaining({id:"linked"})));
  expect(data).toHaveBeenCalledWith("calendar_start",{event});
  vi.mocked(data).mockResolvedValue([]);
});
