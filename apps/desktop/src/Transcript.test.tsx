import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Transcript } from "./Transcript";
import { Settings } from "./Settings";
import { data } from "./api";
vi.mock("./api", () => ({
  data: vi.fn(async () => []),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(cleanup);
const props = {
  segments: [],
  onDelete: vi.fn(),
  onCopy: <button>Copy transcript</button>,
};
test.each([
  ["stopped", "No transcript yet"],
  ["starting", "Getting ready…"],
  ["recording", "Listening…"],
  ["paused", "Paused at 0:20"],
  ["finishing", "Writing down the last few words…"],
])("empty transcript %s", (state, copy) => {
  render(<Transcript {...props} state={state} elapsed={20000} />);
  expect(screen.getByText(copy)).toBeTruthy();
  expect(screen.queryByLabelText("Search transcript")).toBeNull();
  expect(screen.queryByText("Copy transcript")).toBeNull();
  expect(screen.queryByText("Delete selected")).toBeNull();
});
test("silent take explains what happened and offers retry", () => {
  const retry = vi.fn();
  render(<Transcript {...props} finished elapsed={20000} onRecord={retry} />);
  expect(screen.getByText("No words were picked up")).toBeTruthy();
  expect(screen.getByText(/ran for 0 min 20 s/)).toBeTruthy();
  fireEvent.click(screen.getByText("Record again"));
  expect(retry).toHaveBeenCalled();
});
const line = (seq: number, start_ms = seq * 1000) => ({
  id: String(seq),
  note_id: "n",
  seq,
  start_ms,
  speaker: "Me",
  text: `Line ${seq}`,
});
test("new lines scroll only the list when already at bottom, never the page", () => {
  const jump = vi.fn();
  HTMLElement.prototype.scrollIntoView = jump;
  const view = render(<Transcript {...props} segments={[line(2)]} />);
  const list = view.container.querySelector(".segments") as HTMLDivElement;
  Object.defineProperties(list, {
    scrollHeight: { value: 1000, configurable: true },
    clientHeight: { value: 200, configurable: true },
  });
  expect(list.scrollTop).toBe(0);
  list.scrollTop = 100;
  fireEvent.scroll(list);
  view.rerender(<Transcript {...props} segments={[line(2), line(1)]} />);
  expect(list.scrollTop).toBe(100);
  expect(screen.getByText("New lines ↓")).toBeTruthy();
  expect(view.container.querySelector("article")?.id).toBe("segment-1");
  list.scrollTop = 750;
  fireEvent.scroll(list);
  view.rerender(
    <Transcript {...props} segments={[line(2), line(1), line(3)]} />,
  );
  expect(list.scrollTop).toBe(1000);
  expect(jump).not.toHaveBeenCalled();
});
test("microphone-only transcripts hide unreliable speakers and show live footer", () => {
  render(
    <Transcript
      {...props}
      state="recording"
      systemAudio={false}
      segments={[line(1)]}
    />,
  );
  expect(screen.queryByText("You")).toBeNull();
  expect(screen.getByText("Listening…")).toBeTruthy();
});
test("expiry and deletion explain the consequence", () => {
  const view = render(
    <Transcript {...props} expiry={{ expires: "2026-12-14" }} />,
  );
  expect(screen.getByText(/This transcript will be deleted on/)).toBeTruthy();
  view.rerender(<Transcript {...props} expiry={{ deleted_after: 30 }} />);
  expect(
    screen.getByText(/deleted after 30 days, as chosen in Settings/),
  ).toBeTruthy();
});
test("retention selects keep forever by default and preserve custom saved durations", async () => {
  render(
    <Settings
      initial={{ retention: 17 }}
      onClose={vi.fn()}
      onError={vi.fn()}
    />,
  );
  const transcripts = screen.getByLabelText(
    "Keep transcripts for",
  ) as HTMLSelectElement;
  expect(transcripts.value).toBe("17");
  expect(
    (screen.getByLabelText("Keep screen pictures for") as HTMLSelectElement)
      .value,
  ).toBe("0");
  expect(Array.from(transcripts.options).map((o) => o.text)).toEqual([
    "Keep forever",
    "1 year",
    "90 days",
    "30 days",
    "17 days",
  ]);
  fireEvent.change(transcripts, { target: { value: "0" } });
  fireEvent.click(screen.getByText("Save changes"));
  await vi.waitFor(() =>
    expect(data).toHaveBeenCalledWith("save_settings", { retention: 0 }),
  );
});
