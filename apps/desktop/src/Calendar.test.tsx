import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Agenda, CalendarSettings, type CalendarEvent } from "./Calendar";
import { data, invoke, type Note } from "./api";
vi.mock("./api", () => ({ data: vi.fn(), invoke: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const event: CalendarEvent = {
  source_id: "s",
  uid: "event",
  instance_start: new Date(Date.now() - 60000).toISOString(),
  instance_end: new Date(Date.now() + 3600000).toISOString(),
  all_day: false,
  title: "Garden planning",
  attendees: [{ name: "Alex", email: "alex@example.test" }],
  meeting_url: "https://meet.google.com/abc",
};
test("agenda groups events, highlights now, and opens the note returned by storage", async () => {
  const note = {
    id: "n",
    title: event.title,
    attendees: event.attendees,
  } as Note;
  vi.mocked(data).mockImplementation(
    async (action) =>
      structuredClone(
        action === "calendar_events" ? [{ event, note_id: null }] : note,
      ) as never,
  );
  const open = vi.fn();
  render(<Agenda onOpen={open} onError={vi.fn()} />);
  expect(await screen.findByText("Happening now")).toBeTruthy();
  expect(
    screen.getByRole("heading", {
      name: new Date(event.instance_start).toLocaleDateString(),
    }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start notes" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(note));
});
test("calendar settings clear the secret after saving and expose opt-in preferences", async () => {
  vi.mocked(data).mockResolvedValue([]);
  vi.mocked(invoke).mockResolvedValue({ count: 3 });
  const change = vi.fn();
  render(
    <CalendarSettings
      onError={vi.fn()}
      prefs={{ provider: "OpenAI" }}
      onChange={change}
    />,
  );
  const input = screen.getByLabelText("Private calendar link");
  fireEvent.change(input, {
    target: { value: "https://calendar.example.test/private-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Test link" }));
  expect(await screen.findByText("3 events in the next 120 days")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add calendar" }));
  await screen.findByText("Calendar saved on this computer");
  expect((input as HTMLInputElement).value).toBe("");
  expect(document.body.innerHTML).not.toContain("private-secret");
  const reminder = screen.getByLabelText(
    "Show meeting reminders while the app is open",
  ) as HTMLInputElement;
  expect(
    (
      screen.getByLabelText(
        "Start capture automatically when a meeting begins",
      ) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(reminder.checked).toBe(false);
  fireEvent.click(reminder);
  expect(change).toHaveBeenCalledWith("calendar_reminders", true);
  expect(screen.getByText(/Your cloud provider will receive/)).toBeTruthy();
});
