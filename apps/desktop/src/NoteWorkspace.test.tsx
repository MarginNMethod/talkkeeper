import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NoteWorkspace } from "./NoteWorkspace";
import { RecordingConsent } from "./RecordingConsent";
afterEach(cleanup);
test("notes tabs switch with click and keyboard and show only one representation", () => {
  render(<NoteWorkspace notes={<p>Rough draft</p>} written={<p>Finished draft</p>} summary="Finished draft" controls={<button>Write up my notes</button>} onEdit={vi.fn()} readOnly={false} />);
  expect(screen.getByRole("tab", {name:"My notes"}).getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(screen.getByRole("tab", {name:"My notes"}), {key:"ArrowRight"});
  expect(screen.getByRole("tabpanel").textContent).toContain("Finished draft");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"Edit"}));
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(screen.queryByText("Finished draft", {selector:"p"})).toBeNull();
});
test("consent waits for explicit confirmation and permits cancellation", () => {
  const start = vi.fn(), cancel = vi.fn();
  render(<RecordingConsent onStart={start} onCancel={cancel} onCopy={vi.fn()} />);
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Not yet"}));
  expect(cancel).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Start recording"}));
  expect(start).toHaveBeenCalledOnce();
});

test("a narrow window puts the transcript in a third keyboard-accessible tab", () => {
  const media = vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  render(<NoteWorkspace notes={<p>Draft</p>} written={<p>Summary</p>} summary="" controls={<button>Write up my notes</button>} onEdit={vi.fn()} readOnly={false} transcript={<p>Spoken words</p>} />);
  fireEvent.keyDown(screen.getByRole("tab", {name:"My notes"}), {key:"End"});
  expect(screen.getByRole("tab", {name:"Transcript"}).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe("Spoken words");
  media.mockRestore();
});
