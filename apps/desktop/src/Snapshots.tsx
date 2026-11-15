import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { data, invoke, type Preferences } from "./api";
interface Snapshot {
  id: string;
  captured_at: string;
  elapsed_ms: number;
  source: string;
  use_in_summary: boolean;
}
interface Source {
  id: string;
  name: string;
}
interface AiStatus {
  destination?: string;
  supports_images: boolean;
  cloud: boolean;
  confirmed: boolean;
}
const screenControl = <T,>(action: string, extra: object = {}) =>
  invoke<T>("snapshot_control", { action, ...extra });
function time(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
}
export function SnapshotControls({
  noteId,
  status,
  onError,
}: {
  noteId: string | null;
  status: string;
  onError: (e: unknown) => void;
}) {
  const autoMeeting = useRef<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState(0);
  const [picking, setPicking] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [source, setSource] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const state = await screenControl<{ enabled: boolean } | null>("status");
    setEnabled(state?.enabled ?? false);
    if (noteId)
      setCount(
        (await data<Snapshot[] | null>("snapshots", { id: noteId }))?.length ??
          0,
      );
  }
  async function pick() {
    setSources([]);
    setSource("");
    setConfirmed(false);
    setPicking(true);
  }
  useEffect(() => {
    if (status === "stopped") {
      autoMeeting.current = null;
      setEnabled(false);
      setPicking(false);
      return;
    }
    void refresh().catch(onError);
    if (status === "recording" && noteId && autoMeeting.current !== noteId) {
      autoMeeting.current = noteId;
      void data<Preferences>("settings")
        .then(async (p) => {
          if (p?.snapshots_preference === "Always on") {
            const active = await screenControl<boolean>("auto");
            if (active) await refresh();
            else await pick();
          }
        })
        .catch(onError);
    }
  }, [noteId, status]);
  useEffect(() => {
    const subscriptions = [
      listen("snapshots://changed", () => void refresh().catch(onError)),
      listen<string>("snapshots://error", (e) => {
        setEnabled(false);
        onError(e.payload);
      }),
    ];
    return () => {
      for (const sub of subscriptions) void sub.then((off) => off());
    };
  }, [noteId]);
  async function enable() {
    setBusy(true);
    try {
      await screenControl("enable", { source: source || null, confirmed });
      setEnabled(true);
      setPicking(false);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Screen pictures controls" className="snapshot-controls">
      {!enabled ? (
        <button
          disabled={status !== "recording" || !noteId}
          onClick={() => void pick().catch(onError)}
        >
          Take pictures of my screen
        </button>
      ) : (
        <>
          <span role="status">
            {status === "paused" ? "Screen pictures paused" : "Taking screen pictures"} · {count}{" "}

          </span>
          <button
            onClick={() =>
              void screenControl("disable")
                .then(() => setEnabled(false))
                .catch(onError)
            }
          >
            Turn off
          </button>
        </>
      )}
      {picking && createPortal(
        <div className="snapshot-consent" role="dialog" aria-label="Which window or screen?">
          <p>
            Snapshots can contain private messages, documents, and other
            people's information. Choose one window where possible and obtain
            permission from participants. TalkKeeper windows are excluded.
            Images stay on this device unless you separately confirm sending
            them to an online AI service.
          </p>
          <label>
            Screen source
            <select
              aria-label="Screen source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">The window in front</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                if (e.target.checked)
                  void screenControl<Source[]>("sources")
                    .then(setSources)
                    .catch((e) => {
                      setConfirmed(false);
                      onError(e);
                    });
              }}
            />
            I understand and agree to take pictures of this source
          </label>
          <p>
            Every 10 seconds, changed images only. Up to 60 JPEGs per note, 1
            MiB each, resized to 1600 pixels.
          </p>
          <button
            disabled={!confirmed || busy || !sources.length}
            onClick={() => void enable()}
          >
            Start taking pictures
          </button>
          <button onClick={() => setPicking(false)}>Cancel pictures</button>
        </div>, document.body
      )}
    </section>
  );
}
function SnapshotImage({
  noteId,
  snapshot,
}: {
  noteId: string;
  snapshot: Snapshot;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void data<string>("snapshot_image", { id: noteId, snapshot: snapshot.id })
      .then((s) => {
        if (active) setSrc(s);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [noteId, snapshot.id]);
  return (
    <>
      {src && (
        <img
          className="snapshot-thumbnail"
          src={src}
          alt={`Screen picture at ${time(snapshot.elapsed_ms)}`}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function SnapshotGallery({
  noteId,
  onSeek,
  onError,
}: {
  noteId: string;
  onSeek: (ms: number) => void;
  onError: (e: unknown) => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [warning, setWarning] = useState(false);
  async function refresh() {
    const images = await data<Snapshot[] | null>("snapshots", { id: noteId });
    setSnapshots(images ?? []);
    if (images?.length) setAi(await invoke<AiStatus>("snapshot_ai_status", {}));
  }
  useEffect(() => {
    let active = true;
    void data<Snapshot[] | null>("snapshots", { id: noteId })
      .then(async (images) => {
        if (active) setSnapshots(images ?? []);
        if (images?.length) {
          const status = await invoke<AiStatus>("snapshot_ai_status", {});
          if (active) setAi(status);
        }
      })
      .catch(onError);
    const sub = listen(
      "snapshots://changed",
      () => void refresh().catch(onError),
    );
    return () => {
      active = false;
      void sub.then((off) => off());
    };
  }, [noteId]);
  async function mutate(action: string, snapshot?: Snapshot) {
    await data(action, {
      id: noteId,
      snapshot: snapshot?.id,
      excluded: snapshot?.use_in_summary,
    });
    await refresh();
  }
  if (!snapshots.length) return null;
  return (
    <section aria-label="Screen pictures">
      <h2>Screen pictures</h2>
      {(!ai || !ai.supports_images) && (
        <p>
          Your current AI model can't read images; pictures are saved but not
          used.
        </p>
      )}
      {ai?.cloud && !ai.confirmed && (
        <>
          <p>
            Pictures are saved on this computer. To use them in AI notes, confirm sending
            them to your selected online service.
          </p>
          <button onClick={() => setWarning(true)}>
            Review cloud image sharing
          </button>
        </>
      )}
      {warning && (
        <div role="dialog" aria-label="Cloud image sharing">
          <p>
            Your selected online service (
            {ai?.destination ?? "current service"}) will receive included
            screen images when you generate AI notes. They may contain other
            people's private information. This approval applies to the current
            online service.
          </p>
          <button
            onClick={() =>
              void invoke<AiStatus>("snapshot_ai_status", { confirmed: true })
                .then((s) => {
                  setAi(s);
                  setWarning(false);
                })
                .catch(onError)
            }
          >
            Allow images for this service
          </button>
          <button onClick={() => setWarning(false)}>Keep images on this computer</button>
        </div>
      )}
      <button
        onClick={() => {
          if (window.confirm("Delete all screen pictures from this note?"))
            void mutate("snapshot_delete_all").catch(onError);
        }}
      >
        Delete all pictures
      </button>
      <div className="snapshot-gallery">
        {snapshots.map((s) => (
          <figure key={s.id}>
            <SnapshotImage noteId={noteId} snapshot={s} />
            <figcaption>
              {new Date(s.captured_at).toLocaleString()} · {s.source}
            </figcaption>
            <button onClick={() => onSeek(s.elapsed_ms)}>
              Transcript at {time(s.elapsed_ms)}
            </button>
            <label>
              <input
                type="checkbox"
                checked={!s.use_in_summary}
                onChange={() =>
                  void mutate("snapshot_exclude", s).catch(onError)
                }
              />
              Don't use this in the summary
            </label>
            <button
              aria-label={`Delete picture at ${time(s.elapsed_ms)}`}
              onClick={() => void mutate("snapshot_delete", s).catch(onError)}
            >
              Delete picture
            </button>
          </figure>
        ))}
      </div>
    </section>
  );
}
