import { useState } from "react";
import { data, type Template } from "./api";
export function Templates({
  templates,
  onChange,
  onError,
}: {
  templates: Template[];
  onChange: () => void;
  onError: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState<Template | null>(null);
  function edit(t?: Template) {
    setDraft(
      t
        ? { ...t }
        : {
            id: crypto.randomUUID(),
            name: "Custom template",
            description: "",
            sections: [
              {
                heading: "Key points",
                guidance: "Summarize the supported details.",
              },
            ],
            extra_instructions: "",
            built_in: false,
          },
    );
  }
  return (
    <details>
      <summary>Manage templates</summary>
      <button onClick={() => edit()}>Create template</button>
      {templates
        .filter((t) => !t.built_in)
        .map((t) => (
          <div key={t.id}>
            <button onClick={() => edit(t)}>{t.name}</button>
            <button
              onClick={() =>
                void data("delete_template", t).then(onChange).catch(onError)
              }
            >
              Delete {t.name}
            </button>
          </div>
        ))}
      {draft && (
        <div>
          <label>
            Template name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Description
            <input
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label>
            Section headings (one per line)
            <textarea
              value={draft.sections.map((s) => s.heading).join("\n")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  sections: e.target.value.split("\n").map((heading) => ({
                    heading,
                    guidance:
                      "Use the transcript and rough notes to write this section.",
                  })),
                })
              }
            />
          </label>
          <label>
            Instructions
            <textarea
              value={draft.extra_instructions}
              onChange={(e) =>
                setDraft({ ...draft, extra_instructions: e.target.value })
              }
            />
          </label>
          <button
            onClick={() =>
              void data("save_template", draft)
                .then(() => {
                  setDraft(null);
                  onChange();
                })
                .catch(onError)
            }
          >
            Save template
          </button>
          <button onClick={() => setDraft(null)}>Cancel template</button>
        </div>
      )}
    </details>
  );
}
