import { useEffect, useRef, useState } from "react";
import { Card, Button } from "@talkkeeper/ui";
import { data, type Note } from "./api";

type Hit = { note: Note; snippet: string };
export function SearchPalette({ onClose, onOpen, onError }: {
  onClose: () => void;
  onOpen: (note: Note) => void;
  onError: (error: unknown) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(true);
  const previous = useRef(document.activeElement);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const fail = useRef(onError);
  fail.current = onError;
  useEffect(() => {
    input.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('input, button');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    const origin = previous.current;
    return () => { document.removeEventListener("keydown", key); if (origin instanceof HTMLElement && origin.isConnected) origin.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setHits([]);
    void data<Hit[]>("search", { query }).then(rows => {
      if (active) { setHits((rows ?? []).filter(hit => !hit.note.deleted_at)); setLoading(false); }
    }).catch(error => { if (active) { setLoading(false); fail.current(error); } });
    return () => { active = false; };
  }, [query]);
  return <div className="search-backdrop" onClick={onClose}>
    <div ref={dialog}>
      <Card role="dialog" aria-label="Search" aria-modal="true" className="search-palette" onClick={event => event.stopPropagation()}>
        <form onSubmit={event => { event.preventDefault(); if (!loading && hits[0]) onOpen(hits[0].note); }}>
          <input ref={input} autoFocus aria-label="Search notes" placeholder="Search your notes…" value={query} onChange={event => setQuery(event.target.value)} />
          <Button variant="quiet" onClick={onClose}>Close</Button>
        </form>
        <div aria-live="polite" aria-busy={loading}>
          {hits.map(hit => <button className="search-result" key={hit.note.id} onClick={() => onOpen(hit.note)}>{hit.note.title || "Untitled note"}<small>{hit.snippet}</small></button>)}
          {!loading && query && !hits.length && <p>No notes mention “{query}”.</p>}
        </div>
      </Card>
    </div>
  </div>;
}
