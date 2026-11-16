import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useState } from "react";
import { Modal } from "./Modal";
import { RecordingConsent } from "./RecordingConsent";
afterEach(cleanup);
test("modal traps Tab, closes on Escape and returns focus", () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Delete</button>{open && <Modal aria-label="Confirm deletion" onClose={() => setOpen(false)}><button>Confirm</button><button onClick={() => setOpen(false)}>Cancel</button></Modal>}</>;
  }
  render(<Example />);
  const trigger = screen.getByText("Delete");
  trigger.focus(); fireEvent.click(trigger);
  const first = screen.getByText("Confirm"), last = screen.getByText("Cancel");
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, {key:"Tab", shiftKey:true});
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, {key:"Tab"});
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, {key:"Escape"});
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test.each([
  ["Before you record", "dialog"],
  ["Stop the recording?", "alertdialog"],
  ["Delete this note forever?", "alertdialog"],
  ["Delete older transcripts?", "alertdialog"],
] as const)("%s restores focus after Escape and Cancel, including autoFocus children", (label, role) => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <Modal aria-label={label} role={role} onClose={() => setOpen(false)}><button autoFocus>Confirm</button><button onClick={() => setOpen(false)}>Cancel</button></Modal>}</>;
  }
  const { container } = render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open" });
  for (const method of ["Escape", "Cancel"]) {
    trigger.focus();
    fireEvent.click(trigger);
    expect(container.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole(role).contains(document.activeElement)).toBe(true);
    if (method === "Escape") fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole(role)).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("button", { name: "Open" })).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  }
});

test("modal preserves background elements that were already inert", () => {
  const background = document.createElement("div");
  background.setAttribute("inert", "");
  document.body.append(background);
  const { unmount } = render(<Modal aria-label="Confirm" onClose={() => {}}><button>Cancel</button></Modal>);
  unmount();
  expect(background.hasAttribute("inert")).toBe(true);
  background.remove();
});


test("recording consent returns focus to Record when dismissed", () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Record</button>{open && <RecordingConsent onStart={() => {}} onCopy={() => {}} onCancel={() => setOpen(false)} />}</>;
  }
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Record" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Start recording" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
