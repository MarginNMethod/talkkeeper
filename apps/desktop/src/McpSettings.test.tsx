import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { McpSettings } from "./McpSettings";
import { data, invoke } from "./api";
vi.mock("./api", () => ({ data: vi.fn(), invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
test("private defaults, immediate switches, real paths, copy, check and history clear", async () => {
  const prefs = { enabled: false, include_transcripts: false, include_calendar: false };
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const a = args as { action: string; payload: { key: keyof typeof prefs; value: boolean } };
    if (a.action === "status") return structuredClone({ preferences: prefs, executable: "/Applications/TalkKeeper/talkkeeper-mcp", database: "/data/talkkeeper.sqlite" });
    if (a.action === "recent") return [{ timestamp: "2026-11-12T10:00:00Z", tool: "search_notes" }];
    if (a.action === "set") prefs[a.payload.key] = a.payload.value;
    if (a.action === "check") return "Ready. Notes can be read by connected tools.";
    return null;
  });
  render(<McpSettings onError={vi.fn()} />);
  await screen.findByText("search_notes", { exact: false });
  for (const box of screen.getAllByRole("checkbox")) expect((box as HTMLInputElement).checked).toBe(false);
  for (const label of ["Allow other AI tools to read notes", "Include transcripts", "Include calendar meetings"]) {
    fireEvent.click(screen.getByLabelText(label));
    await waitFor(() => expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(true));
  }
  expect(prefs).toEqual({ enabled: true, include_transcripts: true, include_calendar: true });
  expect(screen.getByText(/Privacy warning/)).toBeTruthy();
  expect(screen.getByLabelText("Claude Desktop configuration").textContent).toContain("/Applications/TalkKeeper/talkkeeper-mcp");
  fireEvent.click(screen.getByText("Copy Claude Desktop configuration"));
  await screen.findByText("Claude Desktop configuration copied");
  expect(data).toHaveBeenCalledWith("copy_text", { text: expect.stringContaining("/data/talkkeeper.sqlite") });
  fireEvent.click(screen.getByText("Test MCP connection")); await screen.findByText(/Ready. Notes/);
  fireEvent.click(screen.getByText("Clear recent access")); await screen.findByText("No recent access");
});
test("missing executable has an explicit placeholder", async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => (args as { action: string }).action === "status" ? { preferences: { enabled: false, include_transcripts: false, include_calendar: false }, executable: null, database: "/data/db" } : []);
  render(<McpSettings onError={vi.fn()} />);
  await screen.findByText(/Executable not found/);
  expect(screen.getByLabelText("Claude Desktop configuration").textContent).toContain("<PATH TO talkkeeper-mcp EXECUTABLE>");
});
