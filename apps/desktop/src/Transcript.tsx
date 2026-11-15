import { CopyDiagnostics } from "./CopyDiagnostics";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Segment } from "./api";
import { recordedDuration, recordingTime } from "./RecordBar";
export function Transcript({
  segments,
  onDelete,
  onCopy,
  state = "stopped",
  finished = false,
  noWords = false,
  elapsed = 0,
  systemAudio = true,
  onRecord,
  expiry,
  onSettings,
}: {
  state?: string;
  finished?: boolean;
  noWords?: boolean;
  elapsed?: number;
  systemAudio?: boolean;
  onRecord?: () => void;
  expiry?: { deleted_after?: number; expires?: string } | null;
  onSettings?: () => void;
  segments: Segment[];
  onDelete: (ids: string[]) => void;
  onCopy: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(false);
  const initial = useRef(true);
  const [newLines, setNewLines] = useState(false);
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    const showCitation = () => {
      if (location.hash.startsWith("#segment-")) setQuery("");
    };
    window.addEventListener("hashchange", showCitation);
    return () => window.removeEventListener("hashchange", showCitation);
  }, []);

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      if (list.current)
        atBottom.current =
          list.current.scrollHeight - list.current.clientHeight <= 80;
      return;
    }
    if (atBottom.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
    else setNewLines(true);
  }, [segments]);
  return (
    <section className="transcript">
      <h2>Transcript</h2>
      {segments.length > 0 && (
        <>
          <input
            aria-label="Search transcript"
            placeholder="Find in transcript"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {onCopy}
          <button onClick={() => setSelecting((v) => !v)}>Select</button>
          {selecting && (
            <button
              disabled={!selected.length}
              onClick={() => {
                onDelete(selected);
                setSelected([]);
              }}
            >
              Delete selected
            </button>
          )}
        </>
      )}
      {expiry?.expires && (
        <p>
          This transcript will be deleted on{" "}
          {new Date(expiry.expires).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
          })}
          . Change this in <button onClick={onSettings}>Settings</button>.
        </p>
      )}
      {expiry?.deleted_after && (
        <p>
          The transcript for this meeting was deleted after{" "}
          {expiry.deleted_after} days, as chosen in Settings. Your notes and
          summary are still here.
        </p>
      )}
      {(!segments.length || (finished && noWords)) && (
        <div className={`transcript-empty ${finished ? "record-warning" : ""}`}>
          {state === "starting" ? (
            <p>Getting ready…</p>
          ) : state === "recording" ? (
            <>
              <strong>Listening…</strong>
              <p>Words appear a few seconds after they're spoken.</p>
            </>
          ) : state === "finishing" ? (
            <p>Writing down the last few words…</p>
          ) : state === "paused" ? (
            <p>Paused at {recordingTime(elapsed)}</p>
          ) : finished ? (
            <>
              <strong>No words were picked up</strong>
              <CopyDiagnostics />
              <p>
                The recording ran for {recordedDuration(elapsed)} but no speech
                was recognised. Check your microphone, then try again.
              </p>
              <button onClick={onRecord}>Record again</button>
            </>
          ) : !expiry?.deleted_after ? (
            <>
              <h3>No transcript yet</h3>
              <p>
                Press Record and everything that's said will be written here as
                you go.
              </p>
            </>
          ) : null}
        </div>
      )}
      <div
        className="segments"
        ref={list}
        onScroll={() => {
          const el = list.current;
          if (el) {
            atBottom.current =
              el.scrollHeight - el.clientHeight - el.scrollTop <= 80;
            if (atBottom.current) setNewLines(false);
          }
        }}
      >
        {[...segments]
          .sort((a, b) => a.start_ms - b.start_ms || a.seq - b.seq)
          .filter((s) => s.text.toLowerCase().includes(query.toLowerCase()))
          .map((s) => (
            <article id={`segment-${s.seq}`} key={s.id}>
              <label>
                {selecting && (
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
                )}
                {systemAudio && (
                  <strong>
                    {s.speaker === "Me"
                      ? "You"
                      : s.speaker === "Them"
                        ? "Others"
                        : typeof s.speaker === "object"
                          ? s.speaker.Named
                          : s.speaker}
                  </strong>
                )}{" "}
                <time>
                  {Math.floor(s.start_ms / 60000)}:
                  {String(Math.floor(s.start_ms / 1000) % 60).padStart(2, "0")}
                </time>
              </label>
              <p>{s.text}</p>
            </article>
          ))}
        {segments.length > 0 && (
          <p role="status">
            {state === "recording"
              ? "Listening…"
              : state === "paused"
                ? `Paused at ${recordingTime(elapsed)}`
                : state === "finishing"
                  ? "Writing down the last few words…"
                  : finished
                    ? `End of recording · ${recordedDuration(elapsed)}`
                    : ""}
          </p>
        )}
      </div>
      {newLines && segments.length > 0 && (
        <button
          className="new-lines"
          onClick={() => {
            if (list.current)
              list.current.scrollTop = list.current.scrollHeight;
            atBottom.current = true;
            setNewLines(false);
          }}
        >
          New lines ↓
        </button>
      )}
    </section>
  );
}
