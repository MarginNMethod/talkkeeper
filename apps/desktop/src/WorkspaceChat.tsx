import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { data, invoke, type Note, type Preferences } from "./api";
export interface Scope {
  note_ids: string[] | null;
  folder_id: string | null;
  date_from: string | null;
  date_to: string | null;
}
interface Source {
  note_id: string;
  title: string;
  seq: number;
  start_ms: number;
  text: string;
}
interface Message {
  role: string;
  text: string;
  retrieval: {
    notes_searched: number;
    segments_searched: number;
    sources: Source[];
  };
}
interface Chat {
  id: string;
  name: string;
  scope: Scope;
  messages: Message[];
  attachments: { name: string; text: string }[];
}
export interface Recipe {
  id: string;
  name: string;
  description: string;
  prompt: string;
  default_scope: Scope;
}
const all: Scope = {
  note_ids: null,
  folder_id: null,
  date_from: null,
  date_to: null,
};
export function CitationText({
  message,
  onOpen,
}: {
  message: Message;
  onOpen: (id: string, seq: number) => void;
}) {
  return (
    <p style={{ whiteSpace: "pre-wrap" }}>
      {message.text.split(/(\[S\d+\])/).map((part, i) => {
        const match = /^\[S(\d+)\]$/.exec(part);
        if (!match) return part;
        const source = message.retrieval.sources[Number(match[1]) - 1];
        return source ? (
          <a
            key={i}
            href={`#segment-${source.seq}`}
            onClick={(e) => {
              e.preventDefault();
              onOpen(source.note_id, source.seq);
            }}
          >
            [{source.title} · {Math.floor(source.start_ms / 60000)}:
            {String(Math.floor(source.start_ms / 1000) % 60).padStart(2, "0")}]
          </a>
        ) : (
          "[unavailable source]"
        );
      })}
    </p>
  );
}
export function RecipeEditor({
  recipe,
  onSave,
  onCancel,
}: {
  recipe: Recipe;
  onSave: (r: Recipe) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(recipe);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <label>
        Recipe name
        <input
          required
          maxLength={200}
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <label>
        Description
        <input
          maxLength={2000}
          value={value.description}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
        />
      </label>
      <label>
        Prompt
        <textarea
          required
          maxLength={16000}
          value={value.prompt}
          onChange={(e) => setValue({ ...value, prompt: e.target.value })}
        />
      </label>
      <p>
        Optional variables: {"{{notes}}"}, {"{{topic}}"}. The current scope
        becomes the recipe default.
      </p>
      <button>Save recipe</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
export function WorkspaceChat({
  selected,
  folders,
  onOpen,
  onSaved,
}: {
  selected: string[];
  folders: { id: string; name: string }[];
  onOpen: (id: string, seq: number) => void;
  onSaved: (n: Note) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]),
    [chats, setChats] = useState<Chat[]>([]),
    [chat, setChat] = useState<Chat | null>(null),
    [mode, setMode] = useState("all"),
    [scope, setScope] = useState<Scope>(all),
    [recipes, setRecipes] = useState<Recipe[]>([]),
    [recipeId, setRecipeId] = useState(""),
    [editing, setEditing] = useState<Recipe | null>(null),
    [question, setQuestion] = useState(""),
    [topic, setTopic] = useState(""),
    [busy, setBusy] = useState(false),
    [partial, setPartial] = useState(""),
    [error, setError] = useState(""),
    [cloud, setCloud] = useState(false);
  const fail = (e: unknown) => setError(String(e));
  const refreshRecipes = () => data<Recipe[]>("recipes").then(setRecipes);
  useEffect(() => {
    void data<Note[]>("list").then(setNotes).catch(fail);
    void data<Chat[]>("workspace_chats").then(setChats).catch(fail);
    void refreshRecipes().catch(fail);
    void data<Preferences>("settings")
      .then((p) =>
        setCloud(!["Automatic", "Ollama"].includes(p.provider ?? "Automatic")),
      )
      .catch(fail);
  }, []);
  const effective =
    mode === "selected" ? { ...scope, note_ids: selected } : scope;
  const count = notes.filter(
    (n) =>
      !n.deleted_at &&
      (!effective.note_ids || effective.note_ids.includes(n.id)) &&
      (!effective.folder_id || n.folder_id === effective.folder_id) &&
      (!effective.date_from || n.created_at >= effective.date_from) &&
      (!effective.date_to || n.created_at <= effective.date_to),
  ).length;
  async function save(next: Chat) {
    await data("save_workspace_chat", next);
    setChat(next);
    setChats((cs) => [next, ...cs.filter((c) => c.id !== next.id)]);
  }
  async function run() {
    setBusy(true);
    setPartial("");
    setError("");
    let unlisten: (() => void) | undefined;
    try {
      const recipe = recipes.find((r) => r.id === recipeId);
      const next = {
        ...(chat ?? { id: crypto.randomUUID(), messages: [], attachments: [] }),
        name: recipe?.name ?? (question.slice(0, 80) || "Workspace chat"),
        scope: effective,
      };
      await save(next);
      unlisten = await listen<{ chat_id: string; delta: string }>(
        "workspace://delta",
        (e) => {
          if (e.payload.chat_id === next.id)
            setPartial((p) => p + e.payload.delta);
        },
      );
      const result = await invoke<Chat>("ask_workspace", {
        chatId: next.id,
        question: question || recipe?.name || "",
        recipeId: recipeId || null,
        topic,
      });
      setChat(result);
      setChats((cs) => [result, ...cs.filter((c) => c.id !== result.id)]);
      setQuestion("");
    } catch (e) {
      fail(e);
    } finally {
      unlisten?.();
      setBusy(false);
      setPartial("");
    }
  }
  function exportRecipe(recipe: Recipe) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "recipe.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="workspace-chat">
      <h2>Ask your notes</h2>
      {cloud && (
        <p role="status">
          Cloud provider active: retrieved notes and attached context are sent
          to your selected AI provider.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <legend>Scope</legend>
        <label>
          Choose scope
          <select
            aria-label="Choose scope"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setScope(all);
            }}
          >
            {mode === "saved selection" && (
              <option value="saved selection">Saved selected notes</option>
            )}
            <option value="all">All notes</option>
            <option value="selected">Selected notes</option>
            <option value="folder">A folder</option>
            <option value="date">Date range</option>
          </select>
        </label>
        {mode === "folder" && (
          <label>
            Scope folder
            <select
              value={scope.folder_id ?? ""}
              onChange={(e) =>
                setScope({ ...all, folder_id: e.target.value || null })
              }
            >
              <option value="">Choose folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "date" && (
          <>
            {["date_from", "date_to"].map((key) => (
              <label key={key}>
                {key === "date_from" ? "From date" : "Through date"}
                <input
                  type="date"
                  value={
                    scope[key as keyof Scope]?.toString().slice(0, 10) ?? ""
                  }
                  onChange={(e) =>
                    setScope({
                      ...scope,
                      [key]: e.target.value
                        ? `${e.target.value}T${key === "date_from" ? "00:00:00" : "23:59:59.999"}Z`
                        : null,
                    })
                  }
                />
              </label>
            ))}
          </>
        )}
        <div aria-label="Scope chips">
          <span className="pill">
            {mode} · {count} notes included
          </span>
          {effective.folder_id && (
            <span className="pill">
              {folders.find((f) => f.id === effective.folder_id)?.name ??
                "Folder"}
            </span>
          )}
          {(effective.date_from || effective.date_to) && (
            <span className="pill">
              {effective.date_from?.slice(0, 10) ?? "Any date"} –{" "}
              {effective.date_to?.slice(0, 10) ?? "Today"}
            </span>
          )}
          {effective.note_ids?.map((id) => (
            <span className="pill" key={id}>
              {notes.find((n) => n.id === id)?.title ?? id}
            </span>
          ))}
        </div>
      </fieldset>
      <label>
        Reopen chat
        <select
          disabled={busy}
          value={chat?.id ?? ""}
          onChange={(e) => {
            const c = chats.find((c) => c.id === e.target.value) ?? null;
            setChat(c);
            if (c) {
              setScope(c.scope);
              setMode(
                c.scope.note_ids
                  ? "saved selection"
                  : c.scope.folder_id
                    ? "folder"
                    : c.scope.date_from || c.scope.date_to
                      ? "date"
                      : "all",
              );
            }
          }}
        >
          <option value="">New chat</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!chat || busy}
        onClick={() => {
          if (chat)
            void data("delete_workspace_chat", { id: chat.id })
              .then(() => {
                setChats((cs) => cs.filter((c) => c.id !== chat.id));
                setChat(null);
              })
              .catch(fail);
        }}
      >
        Clear chat
      </button>
      <h3>Recipes</h3>
      <label>
        Recipe
        <select
          aria-label="Recipe"
          value={recipeId}
          disabled={busy}
          onChange={(e) => {
            setRecipeId(e.target.value);
            const r = recipes.find((r) => r.id === e.target.value);
            if (r) {
              setScope(r.default_scope);
              setMode(
                r.default_scope.note_ids
                  ? "saved selection"
                  : r.default_scope.folder_id
                    ? "folder"
                    : r.default_scope.date_from || r.default_scope.date_to
                      ? "date"
                      : "all",
              );
            }
          }}
        >
          <option value="">Ask a question</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() =>
          setEditing({
            id: crypto.randomUUID(),
            name: "",
            description: "",
            prompt: "",
            default_scope: effective,
          })
        }
      >
        New recipe
      </button>
      {recipeId &&
        recipes
          .filter((r) => r.id === recipeId)
          .map((r) => (
            <div key={r.id}>
              <p>{r.description}</p>
              <button
                onClick={() => setEditing({ ...r, default_scope: effective })}
              >
                Edit recipe
              </button>
              <button
                onClick={() =>
                  setEditing({
                    ...r,
                    id: crypto.randomUUID(),
                    name: `${r.name} copy`,
                  })
                }
              >
                Duplicate recipe
              </button>
              <button
                onClick={() =>
                  void data("delete_recipe", { id: r.id })
                    .then(refreshRecipes)
                    .then(() => setRecipeId(""))
                    .catch(fail)
                }
              >
                Delete recipe
              </button>
              <button onClick={() => exportRecipe(r)}>Export recipe</button>
            </div>
          ))}
      <label>
        Import recipe
        <input
          type="file"
          accept=".json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              if (file.size > 32768) {
                fail("Recipe exceeds 32 KiB");
                return;
              }
              void file
                .text()
                .then((text) => data("import_recipe", { text }))
                .then(refreshRecipes)
                .catch(fail);
            }
            e.target.value = "";
          }}
        />
      </label>
      {editing && (
        <RecipeEditor
          key={editing.id}
          recipe={editing}
          onCancel={() => setEditing(null)}
          onSave={(r) =>
            void data("save_recipe", r)
              .then(refreshRecipes)
              .then(() => setEditing(null))
              .catch(fail)
          }
        />
      )}
      <label>
        Topic
        <input
          maxLength={2000}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>
      <label>
        Attach text or Markdown (PDF exported as .pdf.txt)
        <input
          disabled={busy}
          type="file"
          accept=".txt,.md"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              if (file.size > 256 * 1024 || !/\.(txt|md)$/i.test(file.name)) {
                fail(
                  "Attach text, Markdown, or PDF exported as .pdf.txt, up to 256 KiB",
                );
                return;
              }
              void file
                .text()
                .then((text) =>
                  save({
                    ...(chat ?? {
                      id: crypto.randomUUID(),
                      name: "Workspace chat",
                      messages: [],
                      attachments: [],
                      scope: effective,
                    }),
                    attachments: [
                      ...(chat?.attachments ?? []),
                      { name: file.name, text },
                    ],
                  }),
                )
                .catch(fail);
            }
            e.target.value = "";
          }}
        />
      </label>
      {!!chat?.attachments.length && (
        <p>
          Attachments are stored locally. Only a bounded text excerpt is sent
          with each question.
        </p>
      )}
      {chat?.attachments.map((a, i) => (
        <div key={i}>
          {a.name}
          <button
            disabled={busy}
            onClick={() =>
              void save({
                ...chat,
                attachments: chat.attachments.filter((_, j) => j !== i),
              }).catch(fail)
            }
          >
            Remove {a.name}
          </button>
        </div>
      ))}
      {chat?.messages.map((m, i) => (
        <article key={i}>
          <strong>{m.role}</strong>
          <CitationText message={m} onOpen={onOpen} />
          {m.role === "assistant" && (
            <>
              <p>
                Searched {m.retrieval.notes_searched} notes /{" "}
                {m.retrieval.segments_searched} segments and sections; retrieved{" "}
                {m.retrieval.sources.length}.
              </p>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(m.text).catch(fail)
                }
              >
                Copy
              </button>
            </>
          )}
        </article>
      ))}
      {busy && (
        <p role="status" style={{ whiteSpace: "pre-wrap" }}>
          {partial || "Searching and answering…"}
        </p>
      )}
      <label>
        Question
        <textarea
          maxLength={8000}
          value={question}
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <button
        disabled={
          busy ||
          (!question.trim() && !recipeId) ||
          (mode === "folder" && !scope.folder_id) ||
          (mode === "date" && !scope.date_from && !scope.date_to)
        }
        onClick={() => void run()}
      >
        {recipeId ? "Run recipe" : "Ask"}
      </button>
      <button
        disabled={busy || !chat?.messages.some((m) => m.role === "assistant")}
        onClick={() =>
          void data<Note>("save_workspace_result", { id: chat?.id })
            .then(onSaved)
            .catch(fail)
        }
      >
        Save as note
      </button>
    </section>
  );
}
