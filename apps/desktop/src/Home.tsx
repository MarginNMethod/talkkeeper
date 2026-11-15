import { useState } from "react";
import { Card, Button } from "@talkkeeper/ui";
import { useCalendarEntries, calendarTimeRange, openCalendarNote } from "./Calendar";
import { NotesList, type NotesListProps } from "./NotesList";

export function Home({ onError, onSettings, onAsk, ...list }: NotesListProps & {
  onError: (error: unknown) => void;
  onSettings: () => void;
  onAsk: (question: string) => void;
}) {
  const { entries, now } = useCalendarEntries(onError);
  const upcoming = entries.filter(({ event }) =>
    Date.parse(event.instance_end) >= new Date(now).setHours(0, 0, 0, 0) &&
    Date.parse(event.instance_start) < now + 4 * 86400000,
  ).sort((a, b) => a.event.instance_start.localeCompare(b.event.instance_start));
  const [question, setQuestion] = useState("");
  return <section className="index-page home-page">
    <h1>{upcoming.length ? "Coming up" : "Home"}</h1>
    <p className="page-description">{new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
    <Card className="upcoming-card" aria-label="Coming up">
      <h2>Coming up</h2>
      {!upcoming.length ? <div><p>No events today</p><Button variant="quiet" onClick={onSettings}>Connect a calendar in Settings</Button></div> :
        upcoming.map(({ event, note_id }) => <div className="upcoming-row" key={`${event.source_id}/${event.uid}/${event.instance_start}`}>
          <div className="event-date" aria-hidden="true">
            <span>{new Date(event.instance_start).toLocaleDateString(undefined, { month: "short" })}</span>
            <strong>{new Date(event.instance_start).getDate()}</strong>
          </div>
          <div className="event-info"><strong>{event.title}</strong><small>{calendarTimeRange(event)}</small></div>
          <Button variant="quiet" onClick={() => void openCalendarNote(event).then(list.onOpen).catch(onError)}>{note_id ? "Open linked note" : "Start notes"}</Button>
        </div>)}
    </Card>
    <NotesList {...list} />
    <form className="ask-anything" onSubmit={event => { event.preventDefault(); if (question.trim()) onAsk(question.trim()); }}>
      <input aria-label="Ask anything" placeholder="Ask anything about your notes…" value={question} onChange={event => setQuestion(event.target.value)} />
      <Button variant="quiet" type="submit" aria-label="Ask anything" disabled={!question.trim()}>↑</Button>
    </form>
  </section>;
}
