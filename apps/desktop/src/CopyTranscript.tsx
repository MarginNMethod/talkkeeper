import { useState } from "react";
import { data, type Note, type Segment } from "./api";
export function speakerName(speaker: Segment["speaker"]): string {
  return typeof speaker === "string" ? speaker : speaker.Named;
}
export function formatTranscript(
  note: Note,
  segments: Segment[],
  timestamps = true,
  speakers = true,
) {
  const header = `${note.title.replace(/\s+/g, " ")} · ${note.created_at.slice(0, 10)}`;
  return [
    header,
    ...[...segments]
      .sort((a, b) => a.seq - b.seq)
      .map(
        (s) =>
          `${timestamps ? `[${String(Math.floor(s.start_ms / 60000)).padStart(2, "0")}:${String(Math.floor(s.start_ms / 1000) % 60).padStart(2, "0")}] ` : ""}${speakers ? `${speakerName(s.speaker)}: ` : ""}${s.text}`,
      ),
  ].join("\n");
}
export function CopyTranscript({
  note,
  segments,
}: {
  note: Note;
  segments: Segment[];
}) {
  const [timestamps, setTimestamps] = useState(true),
    [speakers, setSpeakers] = useState(true);
  const [status, setStatus] = useState(""),
    [fallback, setFallback] = useState("");
  async function copy() {
    const text = formatTranscript(note, segments, timestamps, speakers);
    try {
      await data("copy_text", { text });
      setFallback("");
      const words = segments.reduce(
        (n, s) => n + (s.text.trim().match(/\S+/g)?.length ?? 0),
        0,
      );
      setStatus(`Copied ${words.toLocaleString()} words`);
    } catch {
      setStatus(
        "Clipboard unavailable. Select all and copy the transcript below.",
      );
      setFallback(text);
    }
  }
  return (
    <div className="copy-transcript">
      <button onClick={() => void copy()}>Copy transcript</button>
      <details>
        <summary>Copy options</summary>
        <label>
          <select
            aria-label="Transcript format"
            value={timestamps ? "timestamps" : "text"}
            onChange={(e) => setTimestamps(e.target.value === "timestamps")}
          >
            <option value="timestamps">With timestamps</option>
            <option value="text">Text only</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={speakers}
            onChange={(e) => setSpeakers(e.target.checked)}
          />
          Include speaker names
        </label>
      </details>
      <span role="status">{status}</span>
      {fallback && (
        <div>
          <textarea
            aria-label="Transcript to copy"
            value={fallback}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={(e) => {
              const area =
                e.currentTarget.parentElement?.querySelector("textarea");
              area?.focus();
              area?.select();
            }}
          >
            Select all
          </button>
        </div>
      )}
    </div>
  );
}
