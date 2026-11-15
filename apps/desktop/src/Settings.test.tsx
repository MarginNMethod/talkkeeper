import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Settings } from "./Settings";
import { data, invoke } from "./api";
vi.mock("./api", () => ({
  data: vi.fn().mockResolvedValue([]),
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const open = (retention = 0) =>
  render(
    <Settings initial={{ retention }} onClose={vi.fn()} onError={vi.fn()} />,
  );
test("everyday settings precede collapsed Advanced with one Save", () => {
  open();
  const advanced = screen.getByText("Advanced").closest("details")!;
  expect(advanced.open).toBe(false);
  expect(
    screen.getByLabelText("Language spoken in your meetings"),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("region", { name: "Privacy and storage" })
      .compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /save/i })).toHaveLength(1);
  expect(
    advanced.contains(screen.getByLabelText("Where summaries are written")),
  ).toBe(true);
});
test("shorter transcript storage saves only after confirmation", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Keep transcripts for"), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(
    screen.getByText(/Transcripts older than 30 days will be deleted now/),
  ).toBeTruthy();
  expect(
    vi.mocked(data).mock.calls.some(([action]) => action === "save_settings"),
  ).toBe(false);
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  fireEvent.click(screen.getByText("Confirm and apply"));
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("save_settings", { retention: 30 }),
  );
});
test("longer storage needs no deletion confirmation", async () => {
  open(30);
  fireEvent.change(screen.getByLabelText("Keep transcripts for"), {
    target: { value: "90" },
  });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("save_settings", { retention: 90 }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
test("refreshing AI models never saves pending deletion", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Keep transcripts for"), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByText("Refresh list"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_models"));
  expect(
    vi.mocked(data).mock.calls.some(([action]) => action === "save_settings"),
  ).toBe(false);
});

test("one Save writes preferences and changed voice typing options together", async () => {
  open();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("dictation_data", {action:"settings",payload:{}}));
  fireEvent.click(screen.getByLabelText("Play a sound when starting and stopping"));
  fireEvent.click(screen.getByRole("button", {name:"Save changes"}));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("dictation_data", {action:"save",payload:expect.objectContaining({cues:false})}));
  await waitFor(() => expect(data).toHaveBeenCalledWith("save_settings", {retention:0}));
  expect(screen.getByText("Saved").getAttribute("role")).toBe("status");
});
