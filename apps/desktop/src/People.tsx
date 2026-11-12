import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { data, invoke, type Note } from "./api";
export interface Person {
  id: string;
  name: string;
  email: string;
  company_id: string | null;
  manually_edited: boolean;
}
interface Company {
  id: string;
  name: string;
  domain: string;
}
type Entry = {
  id: string;
  name: string;
  email?: string;
  domain?: string;
  meetings: Note[];
};
export function directorySort(entries: Entry[], query: string, sort: string) {
  return entries
    .filter((p) =>
      [p.name, p.email, p.domain].some((s) =>
        s?.toLowerCase().includes(query.toLowerCase()),
      ),
    )
    .sort((a, b) =>
      sort === "count"
        ? b.meetings.length - a.meetings.length || a.name.localeCompare(b.name)
        : sort === "last"
          ? (
              b.meetings[0]?.started_at ??
              b.meetings[0]?.created_at ??
              ""
            ).localeCompare(
              a.meetings[0]?.started_at ?? a.meetings[0]?.created_at ?? "",
            ) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    );
}
export function People({
  kind,
  initialPerson,
  onSelect,
  onStart,
  onError,
}: {
  kind: "people" | "companies";
  initialPerson?: string;
  onSelect: (n: Note) => void;
  onStart: (p: Person) => void;
  onError: (e: unknown) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]),
    [companies, setCompanies] = useState<Company[]>([]),
    [entries, setEntries] = useState<Entry[]>([]),
    [selected, setSelected] = useState(initialPerson ?? ""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("name"),
    [pairs, setPairs] = useState<[Person, Person][]>([]),
    [merge, setMerge] = useState<[Person, Person] | null>(null),
    [undo, setUndo] = useState(false),
    [topics, setTopics] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<Person | null>(null);
  async function refresh() {
    const [ps, cs] = await Promise.all([
      data<Person[]>("people"),
      data<Company[]>("companies"),
    ]);
    setPeople(ps);
    setCompanies(cs);
    setEntries(
      await Promise.all(
        (kind === "people" ? ps : cs).map(async (p) => ({
          ...p,
          meetings: await data<Note[]>(
            kind === "people" ? "person_meetings" : "company_meetings",
            { id: p.id },
          ),
        })),
      ),
    );
    setPairs(await data<[Person, Person][]>("duplicates"));
    setUndo(Boolean(await data<boolean>("can_undo_people_merge")));
  }
  useEffect(() => {
    setSelected(initialPerson ?? "");
    void refresh().catch(onError);
  }, [kind, initialPerson]);
  useEffect(() => {
    setDraft(people.find((p) => p.id === selected) ?? null);
    setTopics("");
  }, [selected, people]);
  const entry = entries.find((p) => p.id === selected);
  async function summarize() {
    setBusy(true);
    setTopics("");
    const requestId = crypto.randomUUID();
    let stop: (() => void) | undefined;
    try {
      stop = await listen<{ request_id: string; delta: string }>(
        "people://delta",
        (e) => {
          if (e.payload.request_id === requestId)
            setTopics((t) => t + e.payload.delta);
        },
      );
      setTopics(
        await invoke<string>("recent_topics", {
          id: selected,
          company: kind === "companies",
          requestId,
        }),
      );
    } catch (e) {
      onError(e);
    } finally {
      stop?.();
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>{kind === "people" ? "People" : "Companies"}</h2>
      <p>
        Directory details come only from your notes. Recent topics use your
        selected AI provider when requested.
      </p>
      <label>
        Search directory
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <label>
        Sort directory
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">Name</option>
          <option value="last">Last meeting</option>
          <option value="count">Number of meetings</option>
        </select>
      </label>
      <nav>
        {directorySort(entries, query, sort).map((p) => (
          <button key={p.id} disabled={busy} onClick={() => setSelected(p.id)}>
            {p.name} ({p.meetings.length})
          </button>
        ))}
      </nav>
      {entry && (
        <article>
          <h3>{entry.name}</h3>
          {kind === "people" && draft && (
            <>
              <label>
                Person name
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Person email
                <input
                  value={draft.email}
                  onChange={(e) =>
                    setDraft({ ...draft, email: e.target.value })
                  }
                />
              </label>
              <label>
                Company
                <select
                  value={draft.company_id ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, company_id: e.target.value || null })
                  }
                >
                  <option value="">No company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() =>
                  void data("save_person", draft).then(refresh).catch(onError)
                }
              >
                Save person
              </button>
              <button onClick={() => onStart(draft)}>
                Start a note with this person
              </button>
            </>
          )}
          {kind === "companies" && (
            <>
              <p>{companies.find((c) => c.id === selected)?.domain}</p>
              <h4>People at this company</h4>
              {people
                .filter((p) => p.company_id === selected)
                .map((p) => (
                  <p key={p.id}>
                    {p.name} · {p.email}
                  </p>
                ))}
            </>
          )}
          <h4>Meetings</h4>
          {entry.meetings.map((n) => (
            <button key={n.id} onClick={() => onSelect(n)}>
              {n.title} · {new Date(n.created_at).toLocaleDateString()}
            </button>
          ))}
          <h4>Recent topics · AI-generated</h4>
          <p>
            Uses up to 20 recent meetings. Relevant meeting text is sent to your
            selected provider.
          </p>
          <button
            disabled={busy || !entry.meetings.length}
            onClick={() => void summarize()}
          >
            {busy ? "Generating topics…" : "Generate recent topics"}
          </button>
          <p aria-live="polite">{topics}</p>
        </article>
      )}
      {kind === "people" && (
        <>
          <h3>Possible duplicates</h3>
          {pairs.map(([a, b]) => (
            <button key={a.id + b.id} onClick={() => setMerge([a, b])}>
              Review {a.name} / {b.name}
            </button>
          ))}
          {undo && (
            <button
              onClick={() =>
                void data("undo_people_merge")
                  .then(() => {
                    setUndo(false);
                    return refresh();
                  })
                  .catch(onError)
              }
            >
              Undo last merge
            </button>
          )}
        </>
      )}
      {merge && (
        <div role="dialog" aria-label="Merge people">
          <p>
            Keep {merge[0].name} ({merge[0].email}) and combine meetings with{" "}
            {merge[1].name} ({merge[1].email})? The kept profile stays
            unchanged. Undo is available until the next note save or profile
            edit.
          </p>
          <button
            onClick={() =>
              void data("merge_people", {
                id: merge[0].id,
                remove: merge[1].id,
              })
                .then(() => {
                  setMerge(null);
                  setSelected("");
                  setUndo(true);
                  return refresh();
                })
                .catch(onError)
            }
          >
            Merge people
          </button>
          <button onClick={() => setMerge(null)}>Cancel merge</button>
        </div>
      )}
    </section>
  );
}
export function Attendees({
  value,
  onChange,
  onOpen,
}: {
  value: Note["attendees"];
  onChange: (a: Note["attendees"]) => void;
  onOpen: (id: string) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [text, setText] = useState(() =>
    value.map((a) => (a.email ? `${a.name} <${a.email}>` : a.name)).join(", "),
  );
  const prefix = text.includes(",")
    ? text.slice(0, text.lastIndexOf(",") + 1) + " "
    : "";
  useEffect(() => {
    void data<Person[]>("people")
      .then((p) => setPeople(p ?? []))
      .catch(() => {});
  }, []);
  return (
    <div>
      <label>
        Attendees
        <input
          list="attendee-people"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(
              e.target.value.split(",").map((part) => {
                const s = part.trim();
                const known = people.find(
                  (p) =>
                    p.name === s ||
                    p.email === s ||
                    `${p.name} <${p.email}>` === s,
                );
                if (known) return { name: known.name, email: known.email };
                const match = s.match(/^(.*?)\s*<([^>]+)>$/);
                return match
                  ? { name: match[1].trim(), email: match[2] }
                  : {
                      name: s,
                      email: /^[^\s<>@]+@[^\s<>@]+$/.test(s) ? s : "",
                    };
              }),
            );
          }}
        />
      </label>
      <datalist id="attendee-people">
        {people.map((p) => (
          <option
            key={p.id}
            value={prefix + (p.email ? `${p.name} <${p.email}>` : p.name)}
          />
        ))}
      </datalist>
      {value.map((a, i) => {
        const p = people.find((p) =>
          a.email
            ? p.email.toLowerCase() === a.email.toLowerCase()
            : p.name.toLowerCase() === a.name.toLowerCase(),
        );
        return (
          (a.name || a.email) && (
            <button
              key={i}
              onClick={() => onOpen(p?.id ?? (a.email || a.name))}
            >
              Open {a.name || a.email}
            </button>
          )
        );
      })}
    </div>
  );
}
