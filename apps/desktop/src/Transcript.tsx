import { useEffect, useRef, useState } from "react";
import type { Segment } from "./api";
export function Transcript({
  segments,
  onDelete,
  onCopy,
}: {
  segments: Segment[];
  onDelete: (ids: string[]) => void;
  onCopy: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [segments]);
  return (
    <section className="transcript">
      <h2>Transcript</h2>
      <input
        aria-label="Search transcript"
        placeholder="Find in transcript"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button onClick={onCopy}>Copy all</button>
      <button
        disabled={!selected.length}
        onClick={() => {
          onDelete(selected);
          setSelected([]);
        }}
      >
        Delete selected
      </button>
      <div className="segments">
        {segments
          .filter((s) => s.text.toLowerCase().includes(query.toLowerCase()))
          .map((s) => (
            <article id={`segment-${s.seq}`} key={s.id}>
              <label>
                <input
                  type="checkbox"
                  aria-label={`Select segment ${s.seq}`}
                  checked={selected.includes(s.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, s.id]
                        : selected.filter((id) => id !== s.id),
                    )
                  }
                />
                <strong>
                  {typeof s.speaker === "string" ? s.speaker : "Speaker"}
                </strong>{" "}
                <time>
                  {Math.floor(s.start_ms / 60000)}:
                  {String(Math.floor(s.start_ms / 1000) % 60).padStart(2, "0")}
                </time>
              </label>
              <p>{s.text}</p>
            </article>
          ))}
        <div ref={bottom} />
      </div>
    </section>
  );
}
