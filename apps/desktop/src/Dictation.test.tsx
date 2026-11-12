import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DictationSettings } from "./Dictation";
import { invoke } from "./api";
vi.mock("./api", () => ({ invoke: vi.fn(), data: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test("hotkey capture, styles, dictionary, permissions and history CRUD", async () => {
  let history = [
    { id: "1", text: "Plant herbs", created_at: "2026-11-12T00:00:00Z" },
  ];
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const a = args as { action: string; payload: { search?: string } };
    if (a.action === "history")
      return structuredClone(
        history.filter((h) => h.text.includes(a.payload.search ?? "")),
      ) as never;
    if (a.action === "delete") {
      history = [];
      return null as never;
    }
    if (a.action === "permissions")
      return {
        microphone: "Enable microphone",
        paste: "Enable Accessibility",
        devices: ["Mic"],
      } as never;
    return null as never;
  });
  render(
    <DictationSettings prefs={{ stt_engine: "cloud", provider: "OpenAI" }} />,
  );
  await screen.findByText("Plant herbs");
  fireEvent.keyDown(screen.getByLabelText("Dictation hotkey"), {
    key: "d",
    code: "KeyD",
    ctrlKey: true,
    shiftKey: true,
  });
  expect(
    (screen.getByLabelText("Dictation hotkey") as HTMLInputElement).value,
  ).toBe("CommandOrControl+Shift+D");
  fireEvent.change(screen.getByLabelText("Dictation style"), {
    target: { value: "Formal" },
  });
  fireEvent.change(screen.getByLabelText("Style instructions"), {
    target: { value: "Keep names" },
  });
  fireEvent.click(screen.getByText("Add replacement"));
  fireEvent.change(screen.getByLabelText("Spoken phrase 1"), {
    target: { value: "tee keeper" },
  });
  fireEvent.change(screen.getByLabelText("Replacement 1"), {
    target: { value: "TalkKeeper" },
  });
  fireEvent.click(screen.getByText("Save dictation settings"));
  await screen.findByText("Dictation settings saved");
  expect(invoke).toHaveBeenCalledWith(
    "dictation_data",
    expect.objectContaining({
      action: "save",
      payload: expect.objectContaining({
        style: "Formal",
        prompts: { Formal: "Keep names" },
        replacements: [{ from: "tee keeper", to: "TalkKeeper" }],
      }),
    }),
  );
  fireEvent.click(screen.getByText("Check permissions"));
  await screen.findByText("Enable Accessibility");
  fireEvent.change(screen.getByLabelText("Search dictation history"), {
    target: { value: "absent" },
  });
  await screen.findByText("No dictations found.");
  fireEvent.change(screen.getByLabelText("Search dictation history"), {
    target: { value: "" },
  });
  fireEvent.click(await screen.findByText("Delete dictation"));
  await waitFor(() => expect(screen.queryByText("Plant herbs")).toBeNull());
});
