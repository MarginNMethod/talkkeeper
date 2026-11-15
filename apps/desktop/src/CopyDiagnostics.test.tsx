import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CopyDiagnostics } from "./CopyDiagnostics";
import { data, invoke } from "./api";
vi.mock("./api", () => ({ data: vi.fn(), invoke: vi.fn() }));
afterEach(cleanup);
test("copies the diagnostics report and confirms", async () => {
  vi.mocked(invoke).mockResolvedValue("TalkKeeper diagnostic report");
  render(<CopyDiagnostics />);
  fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
  await screen.findByText("Copied");
  expect(invoke).toHaveBeenCalledWith("diagnostics_report");
  expect(data).toHaveBeenCalledWith("copy_text", { text: "TalkKeeper diagnostic report" });
});
