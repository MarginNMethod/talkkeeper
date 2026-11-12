import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Transcript } from "./Transcript";
import { Settings } from "./Settings";
import { Editor } from "./Editor";
import { Summary } from "./Summary";
import { data } from "./api";
vi.mock("./api", () => ({
  data: vi.fn().mockResolvedValue(null),
  invoke: vi
    .fn()
    .mockResolvedValue([{ id: "chosen-model", display_name: "Chosen model" }]),
}));
afterEach(cleanup);
test("transcript selection deletes only selected segments", () => {
  const remove = vi.fn();
  render(
    <Transcript
      segments={[
        {
          id: "one",
          note_id: "n",
          seq: 1,
          start_ms: 1000,
          speaker: "Me",
          text: "A decision",
        },
        {
          id: "two",
          note_id: "n",
          seq: 2,
          start_ms: 2000,
          speaker: "Them",
          text: "Next step",
        },
      ]}
      onDelete={remove}
      onCopy={null}
    />,
  );
  fireEvent.click(screen.getByLabelText("Select segment 2"));
  fireEvent.click(screen.getByText("Delete selected"));
  expect(remove).toHaveBeenCalledWith(["two"]);
  fireEvent.change(screen.getByLabelText("Search transcript"), {
    target: { value: "decision" },
  });
  expect(screen.queryByText("Next step")).toBeNull();
});
test("settings retrieves models and allows explicit model selection", async () => {
  render(<Settings initial={{}} onClose={() => {}} onError={() => {}} />);
  fireEvent.click(screen.getByText("Load models"));
  await waitFor(() => expect(screen.getByText("Chosen model")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("AI model"), {
    target: { value: "chosen-model" },
  });
  expect((screen.getByLabelText("AI model") as HTMLSelectElement).value).toBe(
    "chosen-model",
  );
  fireEvent.click(screen.getByText("Save settings"));
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("save_settings", {
      model: "chosen-model",
    }),
  );
});
test("editor exposes formatting actions and editable notes", () => {
  render(<Editor content="A thought" onChange={() => {}} />);
  for (const label of [
    "Bold",
    "Italic",
    "Heading",
    "Bullets",
    "Numbered",
    "Checklist",
  ])
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Rough notes" })).toBeTruthy();
  fireEvent.click(screen.getByText("Heading"));
  expect(
    screen.getByRole("heading", { name: "A thought", level: 2 }),
  ).toBeTruthy();
});

test("summary citation ranges expose each supporting segment", () => {
  render(
    <Summary
      markdown="## Actions\nReview the plan [#1-2]"
      segments={[
        {
          id: "one",
          note_id: "n",
          seq: 1,
          start_ms: 1000,
          speaker: "Me",
          text: "First evidence",
        },
        {
          id: "two",
          note_id: "n",
          seq: 2,
          start_ms: 2000,
          speaker: "Them",
          text: "Second evidence",
        },
      ]}
    />,
  );
  expect(screen.getByText("Source 1")).toBeTruthy();
  expect(screen.getByText("Source 2")).toBeTruthy();
  fireEvent.click(screen.getByText("Source 2"));
  expect(screen.getByText(/Second evidence/)).toBeTruthy();
});
