import { useEffect, useRef, useState } from "react";
import { data, invoke, type Note, type Preferences } from "./api";
export interface CalendarEvent {
  source_id: string;
  uid: string;
  instance_start: string;
  instance_end: string;
  all_day: boolean;
  title: string;
  attendees: { name: string; email: string }[];
  meeting_url: string | null;
}
interface Entry {
  event: CalendarEvent;
  note_id: string | null;
}
interface Source {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  sync_minutes: number;
  last_synced_at: string | null;
  last_error: string | null;
}
const command = <T,>(action: string, payload: unknown = {}) =>
  invoke<T>("calendar_data", { action, payload });
export function CalendarSettings({
  onError,
  prefs,
  onChange,
}: {
  onError: (e: unknown) => void;
  prefs: Preferences;
  onChange: (key: keyof Preferences, value: unknown) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [url, setUrl] = useState(""),
    [name, setName] = useState(""),
    [color, setColor] = useState("#537cad"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<string | null>(null);
  const load = () =>
    data<Source[]>("calendar_sources").then((s) => setSources(s ?? []));
  useEffect(() => {
    void load().catch(onError);
  }, []);
  async function run(action: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await command<{ count: number; insecure?: boolean }>(
        action,
        { url, name, color },
      );
      if (action === "test")
        setMessage(
          `${result.count} events in the next 120 days${result.insecure ? ". Warning: HTTP sends your link without encryption" : ""}`,
        );
      else {
        setUrl("");
        setName("");
        await load();
        setMessage("Calendar saved on this computer");
      }
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Calendars">
      <h3>Calendars</h3>
      <label>
        Your calendar email (optional)
        <input
          type="email"
          value={prefs.calendar_email ?? ""}
          onChange={(e) => onChange("calendar_email", e.target.value)}
        />
      </label>
      <p>
        Set this to hide invitations you declined. Save settings, then refresh
        your calendars.
      </p>
      <p>
        Anyone with a private calendar link can read it. Keep it private. Links
        are saved in your operating system keychain.
      </p>
      <details>
        <summary>Find your calendar link</summary>
        <p>
          Google Calendar: open calendar settings, then Integrate calendar, and
          copy the secret address in iCal format. Outlook: open Calendar
          settings and publish the calendar to get its ICS link. Apple Calendar:
          use the shared calendar link. Publishing may make your calendar
          readable by anyone with the link.
        </p>
      </details>
      <label>
        Private calendar link
        <input
          type="password"
          autoComplete="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {url.startsWith("http://") && (
        <p role="alert">
          HTTP sends your private link without encryption. Prefer HTTPS.
        </p>
      )}
      <label>
        Calendar name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Calendar colour
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <button disabled={busy || !url} onClick={() => void run("test")}>
        Test link
      </button>
      <button disabled={busy || !url} onClick={() => void run("add")}>
        Add calendar
      </button>
      <button disabled={busy} onClick={() => void run("import")}>
        Import .ics file
      </button>
      <p role="status">{message}</p>
      {sources.map((s) => (
        <article key={s.id}>
          <strong
            style={{ borderLeft: `4px solid ${s.color}`, paddingLeft: 8 }}
          >
            {s.name}
          </strong>
          <p>
            {s.last_error ??
              (s.last_synced_at
                ? `Updated ${Math.max(0, Math.floor((Date.now() - Date.parse(s.last_synced_at)) / 60000))} min ago`
                : "Not updated yet")}
          </p>
          <label>
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) =>
                void data("calendar_save", { ...s, enabled: e.target.checked })
                  .then(load)
                  .catch(onError)
              }
            />
            Enabled
          </label>
          <label>
            Refresh interval (minutes)
            <input
              type="number"
              min={5}
              max={120}
              value={s.sync_minutes}
              onChange={(e) => {
                const minutes = Number(e.target.value);
                if (minutes >= 5 && minutes <= 120)
                  void data("calendar_save", { ...s, sync_minutes: minutes })
                    .then(load)
                    .catch(onError);
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void command("refresh", { id: s.id })
                .then(load)
                .catch(onError)
                .finally(() => setBusy(false));
            }}
          >
            Refresh
          </button>
          <button onClick={() => setRemoving(s.id)}>Remove calendar</button>
          {removing === s.id && (
            <div role="alert">
              <p>
                Remove this calendar and its cached events? Your notes stay.
              </p>
              <button
                onClick={() =>
                  void data("calendar_remove", { id: s.id })
                    .then(load)
                    .then(() => setRemoving(null))
                    .catch(onError)
                }
              >
                Confirm removal
              </button>
              <button onClick={() => setRemoving(null)}>Keep calendar</button>
            </div>
          )}
        </article>
      ))}
      <label>
        <input
          type="checkbox"
          checked={prefs.calendar_reminders ?? false}
          onChange={(e) => onChange("calendar_reminders", e.target.checked)}
        />
        Show meeting reminders while the app is open
      </label>
      <label>
        <input
          type="checkbox"
          checked={prefs.calendar_auto_capture ?? false}
          onChange={(e) => onChange("calendar_auto_capture", e.target.checked)}
        />
        Start capture automatically when a meeting begins
      </label>
      <p>
        Only enable this if you have arranged consent from participants. While
        TalkKeeper is open, an enabled calendar meeting can start microphone and
        system audio capture. The capture indicator stays visible. Leave this
        off to start every recording yourself.
      </p>
      <label>
        <input
          type="checkbox"
          checked={prefs.calendar_details ?? false}
          onChange={(e) => onChange("calendar_details", e.target.checked)}
        />
        Use calendar details when writing notes
      </label>
      <p>
        When enabled, title, time and attendee names are included in AI
        enhancement.
        {!["Automatic", "Ollama"].includes(prefs.provider ?? "Automatic") &&
          " Your cloud provider will receive these details."}
      </p>
    </section>
  );
}
export function Agenda({
  onOpen,
  onError,
}: {
  onOpen: (n: Note) => void;
  onError: (e: unknown) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () =>
      void data<Entry[]>("calendar_events")
        .then((e) => setEntries(e ?? []))
        .catch(onError);
    load();
    const timer = setInterval(() => {
      setNow(Date.now());
      load();
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (
      Date.parse(entry.event.instance_end) < new Date(now).setHours(0, 0, 0, 0)
    )
      continue;
    const day = new Date(entry.event.instance_start).toLocaleDateString();
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }
  return (
    <section aria-label="Today & upcoming">
      <h2>Today & upcoming</h2>
      {!groups.size && <p>No upcoming meetings. Add a calendar in Settings.</p>}
      {[...groups].map(([day, events]) => (
        <section key={day}>
          <h3>{day}</h3>
          {[...events]
            .sort((a, b) => Number(b.event.all_day) - Number(a.event.all_day))
            .map(({ event: e, note_id }) => (
              <article key={`${e.source_id}/${e.uid}/${e.instance_start}`}>
                <p>
                  {e.all_day
                    ? "All day"
                    : `${new Date(e.instance_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${new Date(e.instance_end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                </p>
                <strong>{e.title}</strong>
                <p>{e.attendees.length} attendees</p>
                {!e.all_day &&
                  Date.parse(e.instance_start) <= now &&
                  Date.parse(e.instance_end) > now && (
                    <mark>Happening now</mark>
                  )}
                {e.meeting_url?.startsWith("https://") && (
                  <a href={e.meeting_url} target="_blank" rel="noreferrer">
                    Join meeting
                  </a>
                )}
                <button
                  onClick={() =>
                    void data<Note>("calendar_start", { event: e })
                      .then(onOpen)
                      .catch(onError)
                  }
                >
                  {note_id ? "Open linked note" : "Start notes"}
                </button>
              </article>
            ))}
        </section>
      ))}
    </section>
  );
}
export function CalendarLink({
  note,
  onError,
  onOpen,
}: {
  note: Note;
  onError: (e: unknown) => void;
  onOpen: (n: Note) => void;
}) {
  const [linked, setLinked] = useState<CalendarEvent | null>(null),
    [suggestion, setSuggestion] = useState<CalendarEvent | null>(null);
  useEffect(() => {
    setLinked(null);
    setSuggestion(null);
    void data<CalendarEvent | null>("calendar_note", { id: note.id })
      .then((e) => {
        setLinked(e);
        if (!e)
          return data<Entry[]>("calendar_events").then((entries) =>
            setSuggestion(
              entries?.find(
                ({ event: x }) =>
                  !x.all_day &&
                  Date.parse(x.instance_start) <= Date.now() &&
                  Date.parse(x.instance_end) > Date.now(),
              )?.event ?? null,
            ),
          );
      })
      .catch(onError);
  }, [note.id]);
  return linked ? (
    <aside aria-label="Linked calendar event">
      <p>
        Calendar: {linked.title} ·{" "}
        {new Date(linked.instance_start).toLocaleString()}
      </p>
      <p>Before capturing, notify participants and ask for their consent.</p>
    </aside>
  ) : suggestion ? (
    <button
      onClick={() =>
        void data("calendar_link", { id: note.id, event: suggestion })
          .then(() => {
            setLinked(suggestion);
            onOpen(note);
          })
          .catch(onError)
      }
    >
      Link to {suggestion.title}
    </button>
  ) : null;
}
export function CalendarReminder({
  onOpen,
  onError,
}: {
  onOpen: (n: Note) => void;
  onError: (e: unknown) => void;
}) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  useEffect(() => {
    const seen = new Set<string>();
    const check = async () => {
      const prefs = await data<Preferences>("settings");
      if (!prefs?.calendar_reminders) {
        setEvent(null);
        return;
      }
      const entries = await data<Entry[]>("calendar_events");
      for (const { event: e } of entries ?? []) {
        const minutes = (Date.parse(e.instance_start) - Date.now()) / 60000;
        const key = `${e.source_id}/${e.uid}/${e.instance_start}/${minutes <= 0 ? "start" : "before"}`;
        if (!e.all_day && minutes <= 5 && minutes > -1 && !seen.has(key)) {
          seen.add(key);
          setEvent(e);
          break;
        }
      }
    };
    void check().catch(onError);
    const timer = setInterval(() => void check().catch(onError), 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    event && (
      <aside role="status">
        <p>Meeting starting — start notes? {event.title}</p>
        <button
          onClick={() =>
            void data<Note>("calendar_start", { event })
              .then((n) => {
                setEvent(null);
                onOpen(n);
              })
              .catch(onError)
          }
        >
          Start meeting notes
        </button>
        <button onClick={() => setEvent(null)}>Dismiss reminder</button>
      </aside>
    )
  );
}

export function CalendarAutoCapture({
  active,
  onOpen,
  onError,
}: {
  active: boolean;
  onOpen: (n: Note) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const latest = useRef({ active, onOpen, onError });
  latest.current = { active, onOpen, onError };
  useEffect(() => {
    const seen = new Set<string>();
    let busy = false;
    const check = async () => {
      if (busy || latest.current.active) return;
      busy = true;
      try {
        const prefs = await data<Preferences>("settings");
        if (!prefs?.calendar_auto_capture) return;
        const entries = await data<Entry[]>("calendar_events");
        const entry = entries?.find(
          ({ event: e }) =>
            !e.all_day &&
            Date.parse(e.instance_start) <= Date.now() &&
            Date.parse(e.instance_start) > Date.now() - 60000 &&
            !seen.has(`${e.source_id}/${e.uid}/${e.instance_start}`),
        );
        if (!entry || latest.current.active) return;
        const e = entry.event;
        seen.add(`${e.source_id}/${e.uid}/${e.instance_start}`);
        const note = await data<Note>("calendar_start", { event: e });
        await latest.current.onOpen(note);
        await invoke("start_capture", { noteId: note.id });
      } catch (e) {
        latest.current.onError(e);
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => clearInterval(timer);
  }, []);
  return null;
}
