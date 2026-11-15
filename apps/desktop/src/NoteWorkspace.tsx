import { useEffect, useId, useState, type ReactNode } from "react";

export function NoteWorkspace({ notes, written, controls, summary, onEdit, readOnly, writing = false, transcript }: {
  notes: ReactNode;
  written: ReactNode;
  controls: ReactNode;
  summary: string;
  onEdit: (value: string) => void;
  readOnly: boolean;
  writing?: boolean;
  transcript?: ReactNode;
}) {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 899px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const change = () => { setNarrow(query.matches); setTab(current => current === 2 ? 0 : current); };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const labels = narrow && transcript ? ["My notes", "Written-up notes", "Transcript"] : ["My notes", "Written-up notes"];
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const id = useId();
  useEffect(() => { if (writing) { setTab(1); setEditing(false); } }, [writing]);
  return (
    <div className="columns note-work-area"><section className="note-workspace">
      <div role="tablist" aria-label="Note views">
        {labels.map((label, i) => (
          <button key={label} id={`${id}-tab-${i}`} role="tab"
            aria-selected={tab === i} aria-controls={`${id}-panel-${i}`}
            tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? labels.length - 1 : (tab + (event.key === "ArrowRight" ? 1 : labels.length - 1)) % labels.length;
              setTab(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}>
            {label}{i === 1 && summary ? " •" : ""}
          </button>
        ))}
      </div>
      {controls}
      <div id={`${id}-panel-0`} role="tabpanel" aria-labelledby={`${id}-tab-0`} hidden={tab !== 0}>{notes}</div>
      <div id={`${id}-panel-1`} role="tabpanel" aria-labelledby={`${id}-tab-1`} hidden={tab !== 1}>
        <button disabled={readOnly} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</button>
        {editing
          ? <textarea aria-label="Edit written-up notes" value={summary} readOnly={readOnly} onChange={event => onEdit(event.target.value)} />
          : written}
      </div>
      {narrow && transcript && <div id={`${id}-panel-2`} role="tabpanel" aria-labelledby={`${id}-tab-2`} hidden={tab !== 2}>{transcript}</div>}
    </section>
    {!narrow && transcript && <div className="note-transcript-zone">{transcript}</div>}
    </div>
  );
}
