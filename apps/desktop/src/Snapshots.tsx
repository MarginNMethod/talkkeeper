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
    <section aria-label="Screen capture controls" className="snapshot-controls">
      {!enabled ? (
        <button
          disabled={status !== "recording" || !noteId}
          onClick={() => void pick().catch(onError)}
        >
          Capture shared screen
        </button>
      ) : (
        <>
          <span role="status">
            Screen snapshots {status === "paused" ? "paused" : "on"} · {count}{" "}
            snapshots
          </span>
          <button
            onClick={() =>
              void screenControl("disable")
                .then(() => setEnabled(false))
                .catch(onError)
            }
          >
            Stop snapshots
          </button>
        </>
      )}
      {picking && (
        <div role="dialog" aria-label="Choose screen source">
          <p>
            Snapshots can contain private messages, documents, and other
            people's information. Choose one window where possible and obtain
            permission from participants. TalkKeeper windows are excluded.
            Images stay on this device unless you separately confirm sending
            them to a cloud AI provider.
          </p>
          <label>
            Screen source
            <select
              aria-label="Screen source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">Frontmost window on main display</option>
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
            I understand and agree to capture this source
          </label>
          <p>
            Every 10 seconds, changed images only. Up to 60 JPEGs per note, 1
            MiB each, resized to 1600 pixels.
          </p>
          <button
            disabled={!confirmed || busy || !sources.length}
            onClick={() => void enable()}
          >
            Start snapshots
          </button>
          <button onClick={() => setPicking(false)}>Cancel snapshots</button>
        </div>
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
          alt={`Screen snapshot at ${time(snapshot.elapsed_ms)}`}
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
    <section aria-label="Screen snapshots">
      <h2>Screen snapshots</h2>
      {(!ai || !ai.supports_images) && (
        <p>
          Your current AI model can't read images; snapshots are saved but not
          used.
        </p>
      )}
      {ai?.cloud && !ai.confirmed && (
        <>
          <p>
            Images are saved locally. To use them in AI notes, confirm sending
            them to your selected provider and endpoint.
          </p>
          <button onClick={() => setWarning(true)}>
            Review cloud image sharing
          </button>
        </>
      )}
      {warning && (
        <div role="dialog" aria-label="Cloud image sharing">
          <p>
            Your selected cloud provider (
            {ai?.destination ?? "current endpoint"}) will receive included
            screen images when you generate AI notes. They may contain other
            people's private information. This approval applies to the current
            provider and endpoint.
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
            Allow images for this provider
          </button>
          <button onClick={() => setWarning(false)}>Keep images local</button>
        </div>
      )}
      <button
        onClick={() => {
          if (window.confirm("Delete all screen snapshots from this note?"))
            void mutate("snapshot_delete_all").catch(onError);
        }}
      >
        Delete all snapshots
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
              aria-label={`Delete snapshot at ${time(s.elapsed_ms)}`}
              onClick={() => void mutate("snapshot_delete", s).catch(onError)}
            >
              Delete snapshot
            </button>
          </figure>
        ))}
      </div>
    </section>
  );
}
