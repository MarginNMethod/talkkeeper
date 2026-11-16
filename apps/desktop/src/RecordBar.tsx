import { Popover } from "@talkkeeper/ui";
import { CopyDiagnostics } from "./CopyDiagnostics";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke, type Preferences, data } from "./api";
import { CaptureFeedback, describeRecordingError } from "./CaptureFeedback";
export function recordingTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function recordedDuration(ms: number) {
  return `${Math.floor(ms / 60000)} min ${Math.floor(ms / 1000) % 60} s`;
}
export function levelBars(level: number) {
  return Math.max(0, Math.min(5, Math.ceil(((level + 60) / 48) * 5)));
}
function Level({ label, value }: { label: string; value: number }) {
  const [peak, setPeak] = useState(value);
  const target = useRef(value);
  const holdUntil = useRef(0);
  target.current = value;
  useEffect(() => {
    setPeak((previous) => {
      if (value > previous) {
        holdUntil.current = Date.now() + 150;
        return value;
      }
      return previous;
    });
  }, [value]);
  useEffect(() => {
    const decay = setInterval(() => {
      if (Date.now() >= holdUntil.current)
        setPeak((previous) => Math.max(target.current, previous - 8));
    }, 50);
    return () => clearInterval(decay);
  }, []);
  return (
    <span className="record-level">
      {label}
      <span className="level-bars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} className={i < levelBars(peak) ? "lit" : ""} />
        ))}
      </span>
    </span>
  );
}
export function RecordingElsewhere({
  title,
  elapsed,
  status,
  onGo,
  onStop,
  problem,
}: {
  title: string;
  elapsed: number;
  status: string;
  onGo: () => void;
  onStop: () => void;
  problem?: string;
}) {
  return (
    <aside
      className="recording-elsewhere"
      aria-label="Recording in another note"
    >
      <span className="record-dot" />
      {status === "paused" ? "Paused in" : "Recording in"} {title} ·{" "}
      {recordingTime(elapsed)} {problem && <strong>{problem}</strong>}
      <button onClick={onGo}>Go to it</button>
      <button onClick={onStop}>Stop</button>
    </aside>
  );
}
export interface RecordBarProps {
  state: string;
  elapsed: number;
  hasTranscript: boolean;
  finished: boolean;
  noWords?: boolean;
  systemAudio: boolean;
  speechSize?: string;
  lag?: number;
  levels: Record<string, number>;
  warning: string | null;
  silence: boolean;
  error: string;
  errorElapsed?: number;
  errorEnded?: boolean;
  otherTitle?: string;
  trashed?: boolean;
  dictating?: boolean;
  speechReady?: boolean;
  wordsAt?: number;
  levelsAt?: number;
  onCommand: (command: string) => void;
  onSettings: () => void;
  onMicrophone: () => void;
  onDismissSilence: () => void;
  onRestore: () => void;
  onGo: () => void;
  onStopOther: () => void;
  onStopDictation: () => void;
  onCopyNotice: () => void;
  onDownload: () => void;
  download?: {
    percent: number;
    done: string;
    total: string;
    time: string;
  } | null;
  downloadReady?: boolean;
  snapshots?: ReactNode;
}
export function RecordBar(p: RecordBarProps) {
  const [dismissedProblem, setDismissedProblem] = useState("");
  const [devices, setDevices] = useState<string[]>([]);
  const [usingMicrophone, setUsingMicrophone] = useState("");
  useEffect(() => {
    let mounted = true;
    void invoke<string | null>("current_microphone")
      .then((name) => {
        if (mounted && typeof name === "string") setUsingMicrophone(name);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [p.state]);
  const [microphone, setMicrophone] = useState("");
  const [deviceMessage, setDeviceMessage] = useState("");
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      invoke<string[]>("list_input_devices"),
      data<Preferences>("settings"),
    ])
      .then(([available, prefs]) => {
        if (!mounted) return;
        setDevices(available);
        const saved = prefs.meeting_microphone ?? "";
        setMicrophone(available.includes(saved) ? saved : "");
        if (saved && !available.includes(saved))
          setDeviceMessage(
            "Your saved microphone is unavailable. Using automatic microphone selection.",
          );
      })
      .catch(() => {
        if (mounted)
          setDeviceMessage(
            "Microphones couldn't be listed. Using automatic microphone selection.",
          );
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function changeMicrophone(device: string) {
    try {
      await invoke("recording_preferences", { microphone: device });
      setMicrophone(device);
      setUsingMicrophone(device);
      setDeviceMessage("");
    } catch {
      setDeviceMessage("Your microphone choice couldn't be saved. Try again.");
    }
  }
  const [now, setNow] = useState(Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [soundTime, setSoundTime] = useState(0);
  const [behind, setBehind] = useState(false);
  useEffect(() => {
    if ((p.lag ?? 0) > 15) setBehind(true);
    else if ((p.lag ?? 0) < 5) setBehind(false);
  }, [p.lag]);
  const lastSound = useRef<number | null>(null),
    lastWords = useRef(0),
    firstWords = useRef(0),
    wordsElapsed = useRef(0),
    started = useRef(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (p.state === "starting" || p.state === "stopped") {
      setDismissed([]);
      setDismissedProblem("");
      setSoundTime(0);
      started.current = Date.now();
      lastSound.current = null;
      lastWords.current = 0;
      firstWords.current = 0;
      wordsElapsed.current = 0;
    }
  }, [p.state]);
  useEffect(() => {
    if (p.wordsAt) {
      if (!firstWords.current) firstWords.current = p.wordsAt;
      lastWords.current = p.wordsAt;
      wordsElapsed.current = p.elapsed;
    }
  }, [p.wordsAt]);
  useEffect(() => {
    if (p.state !== "recording") return;
    const level = p.levels.Me ?? -100;
    if (level > -40 && now - (p.levelsAt ?? now) < 1000)
      setSoundTime((s) => s + 250);
    if (level > -60 && now - (p.levelsAt ?? now) < 1000)
      lastSound.current = p.elapsed;
  }, [now, p.state, p.levels.Me]);
  const active = p.state === "recording" || p.state === "paused";
  const blocked =
    p.trashed || !!p.otherTitle || p.dictating || p.speechReady === false;
  const label =
    p.state === "starting"
      ? "Starting…"
      : p.state === "finishing"
        ? "Finishing…"
        : p.state === "recording"
          ? "Stop"
          : p.state === "paused"
            ? "Resume"
            : p.hasTranscript || p.finished
              ? "Record more"
              : "Record";
  const command = ["recording", "starting", "finishing"].includes(p.state)
    ? "stop_capture"
    : p.state === "paused"
      ? "resume_capture"
      : "start_capture";
  const main = () => {
    if (active || p.state === "starting" || p.state === "finishing" || !blocked)
      p.onCommand(command);
  };
  const mainRef = useRef(main);
  mainRef.current = main;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "r"
      ) {
        e.preventDefault();
        mainRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  let sentence = p.finished
    ? `Saved. Recorded ${recordedDuration(p.elapsed)}.`
    : p.hasTranscript
      ? `Recorded ${Math.floor(p.elapsed / 60000)} min · adds to the transcript below.`
      : "Records your microphone and turns it into a transcript on this computer.";
  if (p.state === "starting")
    sentence =
      now - started.current >= 3000
        ? "Loading speech-to-text. The first start can take up to a minute."
        : "Getting ready…";
  if (p.state === "recording")
    sentence = !lastWords.current
      ? "Listening…"
      : now - firstWords.current < 5000
        ? "Recording. Words are appearing in the transcript."
        : "Recording";
  if (p.state === "paused") sentence = "Paused. Nothing is being recorded.";
  if (p.state === "finishing") sentence = "Writing down the last few words…";
  if (p.trashed) sentence = "Restore this note to record in it.";
  if (p.otherTitle)
    sentence = `Already recording in "${p.otherTitle}" (${recordingTime(p.elapsed)}).`;
  if (p.dictating) sentence = "Dictation is on. Stop it to record a meeting.";
  let warning = p.warning;
  if (p.state === "recording") {
    if (
      (p.elapsed >= 8000 && lastSound.current === null) ||
      (lastSound.current !== null && p.elapsed - lastSound.current >= 20000)
    )
      warning = "mic_silent";
    if (soundTime >= 20000 && p.elapsed - wordsElapsed.current >= 45000)
      warning = "no_words";
  }
  if (warning === "mic_silent" && (p.levels.Me ?? -100) > -40) warning = null;
  if (warning === "no_words" && p.wordsAt && now - p.wordsAt < 1000)
    warning = null;
  if (behind) warning = "behind";
  if (p.silence) warning = "long_silence";
  if (p.noWords) warning = "ended_no_words";
  const problem = p.error
    ? describeRecordingError(
        p.error,
        p.errorEnded ?? p.finished,
        recordingTime(p.errorElapsed ?? p.elapsed),
        navigator.platform,
        p.speechSize,
      )
    : null;
  return (
    <section
      className={`record-bar ${p.state === "paused" ? "is-paused" : ""}`}
      aria-label="Recording controls"
    >
      <div className="record-row">
        {active ? (
          <>
            <span
              className={`record-dot ${p.state === "paused" ? "paused" : ""}`}
            />
            <time className="record-timer">{recordingTime(p.elapsed)}</time>
            {p.state === "recording" && (
              <Level
                label="Microphone"
                value={
                  now - (p.levelsAt ?? now) > 1000
                    ? -100
                    : (p.levels.Me ?? -100)
                }
              />
            )}
            <button
              onClick={() =>
                p.onCommand(
                  p.state === "paused" ? "resume_capture" : "pause_capture",
                )
              }
            >
              {p.state === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              className="record-stop"
              onClick={() => p.onCommand("stop_capture")}
            >
              Stop
            </button>
          </>
        ) : p.state === "starting" || p.state === "finishing" ? (
          <>
            <span role="status">
              <span className="record-spinner" aria-hidden="true">
                ◌
              </span>{" "}
              {label}
            </span>
            {p.state === "finishing" && (
              <progress aria-label="Finishing recording" />
            )}
            <button onClick={() => p.onCommand("stop_capture")}>
              {p.state === "starting" ? "Cancel" : "Stop"}
            </button>
          </>
        ) : (
          <button
            className="record-main"
            title="Ctrl/Cmd+Shift+R"
            disabled={!!blocked}
            onClick={main}
          >
            <span aria-hidden="true">●</span> {blocked ? "Record" : label}
          </button>
        )}
        <Popover label="Recording options" keepMounted closeOnAction={false}>
          <label className="meeting-microphone">
            Microphone
            <select
              aria-label="Meeting microphone"
              value={microphone}
              disabled={p.state !== "stopped"}
              onChange={(event) => void changeMicrophone(event.target.value)}
            >
              <option value="">Automatic microphone</option>
              {devices.map((device) => (
                <option key={device}>{device}</option>
              ))}
            </select>
          </label>
          <span>
            Using:{" "}
            {usingMicrophone ||
              microphone ||
              (p.state === "stopped"
                ? "Automatic microphone"
                : "Selecting microphone…")}
          </span>

          <p>
              Tell everyone before you record.{" "}
              <button onClick={p.onCopyNotice}>
                Copy a message to send them
              </button>
            </p>
          <p className="record-source">
            {p.systemAudio
              ? "Records your microphone and your computer's sound."
              : "Records your microphone only. On a call, use your speakers instead of headphones so the other people are picked up."}
          </p>
          {p.snapshots}
        </Popover>
      </div>
      <span className={blocked ? "record-blocked" : "sr-only"} role="status">
        {sentence}
      </span>
      {p.trashed && <button onClick={p.onRestore}>Restore note</button>}
      {p.otherTitle && (
        <>
          <button onClick={p.onGo}>Go to that note</button>
          <button onClick={p.onStopOther}>Stop it</button>
        </>
      )}
      {p.dictating && (
        <button onClick={p.onStopDictation}>Stop dictation</button>
      )}
      {deviceMessage &&
        !warning &&
        !problem &&
        !p.download &&
        !p.downloadReady && (
          <p role="status">
            {deviceMessage} <CopyDiagnostics />
            <button onClick={() => setDeviceMessage("")}>Dismiss</button>
          </p>
        )}
      {!p.otherTitle && (
        <div className="record-feedback">
          <CaptureFeedback
            lag={p.lag}
            systemAudio={p.systemAudio}
            warning={
              !problem &&
              !p.download &&
              !p.downloadReady &&
              warning &&
              !dismissed.includes(warning) &&
              (active || p.noWords)
                ? warning
                : null
            }
            onError={() => p.onSettings()}
            onMicrophone={p.onMicrophone}
            onRestart={() => p.onCommand("restart")}
            onStop={() => p.onCommand("stop_capture")}
            onDismiss={() => {
              if (warning && warning !== "long_silence")
                setDismissed((d) => [...d, warning]);
              p.onDismissSilence();
            }}
          />
          {problem &&
            dismissedProblem !== p.error &&
            !p.download &&
            !p.downloadReady && (
              <div className="record-problem" role="alert">
                <button
                  className="banner-dismiss"
                  aria-label="Dismiss recording problem"
                  onClick={() => setDismissedProblem(p.error)}
                >
                  ×
                </button>
                <strong>{problem.title}</strong>
                <CopyDiagnostics />
                <p>{problem.body}</p>
                <button
                  onClick={
                    problem.action === "Open microphone settings"
                      ? p.onMicrophone
                      : problem.action === "Open Settings"
                        ? p.onSettings
                        : problem.action === "Download now"
                          ? p.onDownload
                          : () => p.onCommand("start_capture")
                  }
                >
                  {problem.action}
                </button>
                {problem.action === "Download now" && (
                  <button onClick={p.onSettings}>Open Settings</button>
                )}
                {problem.action === "Open microphone settings" && (
                  <button onClick={() => p.onCommand("start_capture")}>
                    Try again
                  </button>
                )}
                {(p.errorEnded ?? p.finished) &&
                  p.error.includes("overflow") && (
                    <button onClick={p.onSettings}>Speech settings</button>
                  )}
                <details>
                  <summary>Details</summary>
                  <pre>{p.error}</pre>
                  <button
                    onClick={() =>
                      void data("copy_text", { text: p.error }).catch(() => {})
                    }
                  >
                    Copy details
                  </button>
                </details>
              </div>
            )}
          {p.download && dismissedProblem !== "download" && (
            <div role="status">
              <CopyDiagnostics />
              <button
                aria-label="Dismiss download progress"
                onClick={() => setDismissedProblem("download")}
              >
                ×
              </button>
              <strong>
                Downloading speech-to-text… {p.download.percent} %
              </strong>
              <p>
                {p.download.done} of {p.download.total} · about{" "}
                {p.download.time} left. You can keep typing notes. Press Record
                when it finishes.
              </p>
              <button onClick={() => p.onCommand("cancel_download")}>
                Cancel download
              </button>
            </div>
          )}
          {p.downloadReady && dismissedProblem !== "ready" && (
            <div role="status">
              <CopyDiagnostics />
              <button
                aria-label="Dismiss speech ready"
                onClick={() => setDismissedProblem("ready")}
              >
                ×
              </button>
              <strong>Speech-to-text is ready</strong>
              <p>Press Record to start.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
