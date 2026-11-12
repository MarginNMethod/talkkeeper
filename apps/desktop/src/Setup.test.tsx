import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Setup } from "./Setup";
import { invoke } from "./api";
const mocks = vi.hoisted(() => ({ progress: undefined as undefined | ((e: { payload: unknown }) => void) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_: string, callback: typeof mocks.progress) => { mocks.progress = callback; return () => {}; }) }));
vi.mock("./api", () => ({ invoke: vi.fn() }));
const plan = { llm: { friendly_name: "Compact conversation AI", approx_download_gb: 2.7, license: "Apache-2.0", notes: "Open model weights." }, whisper: { approx_download_mb: 78 }, total_download_bytes: 6.8e9, hardware: { os: "macos", total_ram_bytes: 8 * 2 ** 30, free_disk_bytes: 20e9 }, notice: null, can_install: true };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
test("consent precedes setup, progress is shown, and ready opens a note", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(invoke).mockImplementation(async (command) => { if (command === "setup_plan") return plan; if (command === "setup_run") return new Promise<void>((resolve) => { finish = resolve; }); });
  const ready = vi.fn(); render(<Setup onReady={ready} onAdvanced={() => {}} />);
  await screen.findByText(/6.8 GB/);
  expect(invoke).not.toHaveBeenCalledWith("setup_run");
  fireEvent.click(screen.getByText("Set up automatically"));
  await waitFor(() => expect(finish).toBeTruthy());
  mocks.progress?.({ payload: { stage: "PullModel", completed: 50, total: 100, percent: 50, message: "Downloading your AI model" } });
  await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("value")).toBe("50"));
  finish?.(); await screen.findByText("You're ready");
  await waitFor(() => expect(ready).toHaveBeenCalledOnce(), { timeout: 2500 });
});
test("failure gives a fix and retries; advanced path never starts a download", async () => {
  let attempts = 0;
  vi.mocked(invoke).mockImplementation(async (command) => { if (command === "setup_plan") return plan; if (command === "setup_run" && attempts++ === 0) throw new Error("Check your connection and retry."); });
  const advanced = vi.fn(); render(<Setup onReady={() => {}} onAdvanced={advanced} />);
  await screen.findByText(/6.8 GB/);
  fireEvent.click(screen.getByText("Use my own AI provider instead")); expect(advanced).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalledWith("setup_run");
  fireEvent.click(screen.getByText("Set up automatically")); await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Retry setup")); await screen.findByText("You're ready");
});
test("low storage blocks automatic setup and offers advanced settings", async () => {
  vi.mocked(invoke).mockResolvedValue({ ...plan, can_install: false, notice: "Free more storage before setting up local AI." });
  render(<Setup onReady={() => {}} onAdvanced={() => {}} />);
  await screen.findByText(/Free more storage/);
  expect((screen.getByText("Set up automatically") as HTMLButtonElement).disabled).toBe(true);
});
