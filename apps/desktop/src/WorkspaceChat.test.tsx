import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  CitationText,
  RecipeEditor,
  WorkspaceChat,
  type Recipe,
} from "./WorkspaceChat";
import { data } from "./api";
vi.mock("./api", () => ({
  data: vi.fn(async (action: string) =>
    action === "settings" ? { provider: "Ollama" } : [],
  ),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const scope = {
  note_ids: null,
  folder_id: null,
  date_from: null,
  date_to: null,
};
test("citations link only to retrieved sources", () => {
  const open = vi.fn();
  render(
    <CitationText
      message={{
        role: "assistant",
        text: "Decision [S1] [S99]",
        retrieval: {
          notes_searched: 2,
          segments_searched: 3,
          sources: [
            {
              note_id: "a",
              title: "Garden",
              seq: 4,
              start_ms: 90000,
              text: "yes",
            },
          ],
        },
      }}
      onOpen={open}
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "[Garden · 1:30]" }));
  expect(open).toHaveBeenCalledWith("a", 4);
  expect(screen.getAllByRole("link")).toHaveLength(1);
});
test("recipe editor saves text and variables", () => {
  const save = vi.fn();
  render(
    <RecipeEditor
      recipe={{
        id: "a",
        name: "",
        description: "",
        prompt: "",
        default_scope: scope,
      }}
      onSave={save}
      onCancel={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Recipe name"), {
    target: { value: "Follow up" },
  });
  fireEvent.change(screen.getByLabelText("Prompt"), {
    target: { value: "Use {{notes}}" },
  });
  fireEvent.click(screen.getByText("Save recipe"));
  expect(save.mock.calls[0][0].prompt).toBe("Use {{notes}}");
});
test("scope picker, import and export", async () => {
  const recipe: Recipe = {
    id: "r",
    name: "Status",
    description: "",
    prompt: "Summarize",
    default_scope: scope,
  };
  vi.mocked(data).mockImplementation(
    async (action) =>
      (action === "recipes"
        ? [recipe]
        : action === "settings"
          ? {}
          : []) as never,
  );
  const create = vi.fn(() => "blob:recipe");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    value: create,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revoke,
    configurable: true,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(
    <WorkspaceChat
      selected={["a", "b"]}
      folders={[]}
      onOpen={() => {}}
      onSaved={() => {}}
    />,
  );
  await waitFor(() => expect(screen.getByText("Status")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Choose scope"), {
    target: { value: "selected" },
  });
  expect(screen.getByLabelText("Scope chips").textContent).toContain(
    "selected",
  );
  fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "r" } });
  fireEvent.click(screen.getByText("Export recipe"));
  expect(create).toHaveBeenCalled();
  expect(revoke).toHaveBeenCalledWith("blob:recipe");
  const file = new File([JSON.stringify(recipe)], "recipe.json", {
    type: "application/json",
  });
  fireEvent.change(screen.getByLabelText("Import recipe"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(data).toHaveBeenCalledWith("import_recipe", {
      text: JSON.stringify(recipe),
    }),
  );
});
