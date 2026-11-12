import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SnapshotControls, SnapshotGallery } from "./Snapshots";
import { data, invoke } from "./api";
vi.mock("./api", () => ({ data: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
const image = {
  id: "s1",
  captured_at: "2026-11-01T10:00:10Z",
  elapsed_ms: 10000,
  source: "Slides",
  use_in_summary: true,
};
beforeEach(() => {
  vi.mocked(data).mockImplementation(async (action) => {
    if (action === "snapshots") return structuredClone([image]);
    if (action === "snapshot_image") return "data:image/jpeg;base64,/9j/2Q==";
    if (action === "settings") return { snapshots_preference: "Ask each time" };
    return null;
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "snapshot_ai_status")
      return { supports_images: false, cloud: true, confirmed: false };
    if ((args as Record<string, unknown>)?.action === "sources")
      return [{ id: "window:2", name: "Slides window" }];
    return { enabled: false };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test("off by default, first consent, source picker, indicator and one-click stop", async () => {
  const onError = vi.fn();
  render(<SnapshotControls noteId="n1" status="recording" onError={onError} />);
  fireEvent.click(screen.getByText("Capture shared screen"));
  const start = await screen.findByText("Start snapshots");
  expect((start as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/private messages/)).toBeTruthy();
  fireEvent.click(
    screen.getByLabelText("I understand and agree to capture this source"),
  );
  await screen.findByText("Slides window");
  fireEvent.change(screen.getByLabelText("Screen source"), {
    target: { value: "window:2" },
  });
  fireEvent.click(start);
  await screen.findByText("Screen snapshots on · 1 snapshots");
  expect(invoke).toHaveBeenCalledWith("snapshot_control", {
    action: "enable",
    source: "window:2",
    confirmed: true,
  });
  fireEvent.click(screen.getByText("Stop snapshots"));
  await screen.findByText("Capture shared screen");
  expect(onError).not.toHaveBeenCalled();
});
test("stopped capture cannot enable snapshots", () => {
  render(<SnapshotControls noteId={null} status="stopped" onError={vi.fn()} />);
  expect(
    (screen.getByText("Capture shared screen") as HTMLButtonElement).disabled,
  ).toBe(true);
});
test("gallery timestamps, exclusion, deletion, unsupported model and explicit cloud confirmation", async () => {
  const seek = vi.fn();
  render(<SnapshotGallery noteId="n1" onSeek={seek} onError={vi.fn()} />);
  await screen.findByText(/current AI model can't read images/);
  fireEvent.click(screen.getByText("Transcript at 0:10"));
  expect(seek).toHaveBeenCalledWith(10000);
  fireEvent.click(screen.getByLabelText("Don't use this in the summary"));
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("snapshot_exclude", {
      id: "n1",
      snapshot: "s1",
      excluded: true,
    }),
  );
  fireEvent.click(screen.getByLabelText("Delete snapshot at 0:10"));
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("snapshot_delete", {
      id: "n1",
      snapshot: "s1",
      excluded: true,
    }),
  );
  fireEvent.click(screen.getByText("Review cloud image sharing"));
  expect(
    screen.getByRole("dialog", { name: "Cloud image sharing" }),
  ).toBeTruthy();
  expect(invoke).not.toHaveBeenCalledWith("snapshot_ai_status", {
    confirmed: true,
  });
  fireEvent.click(screen.getByText("Allow images for this provider"));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("snapshot_ai_status", {
      confirmed: true,
    }),
  );
});
