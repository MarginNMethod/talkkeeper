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
  const labels = transcript ? ["Notes", "Transcript", "Summary"] : ["Notes", "Summary"];
  const summaryTab = transcript ? 2 : 1;
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const id = useId();
  useEffect(() => { if (writing) { setTab(summaryTab); setEditing(false); } }, [writing, summaryTab]);
  useEffect(() => {
    const reveal = () => { if (location.hash.startsWith("#segment-") || transcript) setTab(1); };
    const hash = () => { if (location.hash.startsWith("#segment-")) setTab(1); };
    window.addEventListener("hashchange", hash);
    window.addEventListener("note:show-transcript", reveal);
    return () => { window.removeEventListener("hashchange", hash); window.removeEventListener("note:show-transcript", reveal); };
  }, [transcript]);
  return (
    <div className="columns note-work-area"><section className="note-workspace">
      <div role="tablist" aria-label="Note views">
        {labels.map((label, i) => (
          <button key={label} id={`${id}-tab-${i}`} role="tab" aria-label={label}
            aria-selected={tab === i} aria-controls={`${id}-panel-${i}`}
            tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? labels.length - 1 : (tab + (event.key === "ArrowRight" ? 1 : labels.length - 1)) % labels.length;
              setTab(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}>
            {label}{i === summaryTab && summary ? " •" : ""}
          </button>
        ))}
      </div>
      <div id={`${id}-panel-0`} role="tabpanel" aria-labelledby={`${id}-tab-0`} hidden={tab !== 0}>{notes}</div>
      <div id={`${id}-panel-${summaryTab}`} role="tabpanel" aria-labelledby={`${id}-tab-${summaryTab}`} hidden={tab !== summaryTab}>
        {controls}
        <button disabled={readOnly} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</button>
        {editing
          ? <textarea aria-label="Edit written-up notes" value={summary} readOnly={readOnly} onChange={event => onEdit(event.target.value)} />
          : written}
      </div>
      {transcript && <div id={`${id}-panel-1`} role="tabpanel" aria-labelledby={`${id}-tab-1`} hidden={tab !== 1}>{transcript}</div>}
    </section>

    </div>
  );
}
