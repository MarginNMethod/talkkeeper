import { Row, EmptyState, IconButton } from "@talkkeeper/ui";
import type { Note } from "./api";

export function noteGroup(date: string, now = new Date()) {
  const day = new Date(date);
  const localDay = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const age = (localDay(now) - localDay(day)) / 86400000;
  return age === 0 ? "Today" : age === 1 ? "Yesterday" : age > 1 && age < 7
    ? day.toLocaleDateString(undefined, { weekday: "long" })
    : day.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export interface NotesListProps {
  notes: Note[];
  onOpen: (note: Note) => void;
  captureNote?: string | null;
  durations?: Record<string, number>;
}

export function NotesList({ notes, onOpen, captureNote, durations = {} }: NotesListProps) {
  const groups = new Map<string, Note[]>();
  for (const note of [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const day = noteGroup(note.created_at);
    groups.set(day, [...(groups.get(day) ?? []), note]);
  }
  return <div className="home-notes">
    {!notes.length && <EmptyState title="A place to collect the conversation">Create a note to write, record, and find the details that matter.</EmptyState>}
    {[...groups].map(([day, entries]) => <section key={day} aria-label={`${day} notes`}>
      <h3 className="day-label">{day}</h3>
      {entries.map(note => {
        const title = note.title.trim() || "Untitled note";
        const snippet = note.notes_markdown?.replace(/[#*_`]/g, "").trim().slice(0, 100);
        const subtitle = note.attendees.map(person => person.name || person.email).join(", ") || snippet ||
          (captureNote === note.id ? "Recording…" : durations[note.id] ? `${Math.max(1, Math.round(durations[note.id] / 60000))} min` : "No recording");
        return <Row key={note.id} icon={<span className="note-avatar" aria-hidden="true">{title[0].toUpperCase()}</span>}
          title={<button className="note-row-link" onClick={() => onOpen(note)}>{title}</button>}
          subtitle={subtitle}
          trailing={<time dateTime={note.created_at}>{new Date(note.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
          actions={<IconButton aria-label={`Open ${title}`} onClick={() => onOpen(note)}>↗</IconButton>} />;
      })}
    </section>)}
  </div>;
}
