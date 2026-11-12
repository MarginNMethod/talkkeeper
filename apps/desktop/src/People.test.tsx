import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Attendees, People, directorySort } from "./People";
import { data, type Note } from "./api";
vi.mock("./api", () => ({ data: vi.fn(), invoke: vi.fn() }));
const ada = {
  id: "a",
  name: "Ada",
  email: "ada@example.org",
  company_id: null,
  manually_edited: false,
};
const other = { ...ada, id: "b", email: "other@example.org" };
const meeting = {
  id: "n",
  title: "Planning",
  created_at: "2026-01-01",
} as Note;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function backend() {
  vi.mocked(data).mockImplementation(
    async (action) =>
      ({
        people: [ada, other],
        companies: [],
        person_meetings: [meeting],
        duplicates: [[ada, other]],
      })[action as "people"] as never,
  );
}
test("directory searches names and email and sorts meeting counts and dates", () => {
  const entries = [
    { ...ada, meetings: [meeting] },
    { id: "z", name: "Zed", meetings: [] },
  ];
  expect(directorySort(entries, "EXAMPLE", "name").map((p) => p.id)).toEqual([
    "a",
  ]);
  expect(directorySort(entries, "", "name").map((p) => p.id)).toEqual([
    "a",
    "z",
  ]);
  expect(directorySort(entries, "", "count")[0].id).toBe("a");
  expect(directorySort(entries, "", "last")[0].id).toBe("a");
});
test("attendee suggestions preserve known email and open the person", async () => {
  backend();
  const change = vi.fn(),
    open = vi.fn();
  render(
    <Attendees
      value={[{ name: "Ada", email: ada.email }]}
      onChange={change}
      onOpen={open}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Open Ada" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open Ada" }));
  expect(open).toHaveBeenCalledWith("a");
  fireEvent.change(screen.getByLabelText("Attendees"), {
    target: { value: "Ada <ada@example.org>, New <new@team.org>" },
  });
  expect(change).toHaveBeenCalledWith([
    { name: "Ada", email: ada.email },
    { name: "New", email: "new@team.org" },
  ]);
});
test("person page lists meetings, starts notes and confirms merge", async () => {
  backend();
  const start = vi.fn(),
    select = vi.fn();
  render(
    <People
      kind="people"
      initialPerson="a"
      onStart={start}
      onSelect={select}
      onError={(e) => {
        throw e;
      }}
    />,
  );
  fireEvent.click(await screen.findByText("Start a note with this person"));
  expect(start).toHaveBeenCalledWith(ada);
  fireEvent.click(screen.getByRole("button", { name: /Planning/ }));
  expect(select).toHaveBeenCalledWith(meeting);
  fireEvent.click(screen.getByRole("button", { name: "Review Ada / Ada" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel merge" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review Ada / Ada" }));
  fireEvent.click(screen.getByRole("button", { name: "Merge people" }));
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("merge_people", { id: "a", remove: "b" }),
  );
});

test("attendee typing preserves partial email text", () => {
  backend();
  render(<Attendees value={[]} onChange={() => {}} onOpen={() => {}} />);
  const input = screen.getByLabelText("Attendees") as HTMLInputElement;
  for (const text of [
    "Ada <a",
    "Ada <a@",
    "Ada <a@team.org>",
    "Ada <a@team.org>, ",
  ]) {
    fireEvent.change(input, { target: { value: text } });
    expect(input.value).toBe(text);
  }
});
