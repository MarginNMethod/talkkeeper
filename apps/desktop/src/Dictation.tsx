import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { data, invoke, type Preferences } from "./api";
export const voice = <T,>(action: string, payload: unknown = {}) =>
  invoke<T>("dictation_data", { action, payload });
interface Config {
  hotkey: string;
  mode: string;
  style: string;
  days: number;
  cues: boolean;
  replacements: { from: string; to: string }[];
  prompts: Record<string, string>;
}
interface Entry {
  id: string;
  text: string;
  created_at: string;
}
const defaults: Config = {
  hotkey: "CommandOrControl+Shift+Space",
  mode: "toggle",
  style: "As spoken",
  days: 7,
  cues: true,
  replacements: [],
  prompts: {},
};
export function DictationSettings({ prefs }: { prefs: Preferences }) {
  const [config, setConfig] = useState(defaults);
  const [history, setHistory] = useState<Entry[]>([]);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [permissions, setPermissions] = useState<{
    microphone: string;
    paste: string;
    devices: string[];
  } | null>(null);
  const fail = (e: unknown) => setNotice(String(e));
  const refresh = () =>
    voice<Entry[]>("history", { search })
      .then((h) => setHistory(h ?? []))
      .catch(fail);
  useEffect(() => {
    void voice<Config>("settings")
      .then((c) => setConfig(c ?? defaults))
      .catch(fail);
  }, []);
  useEffect(() => {
    void refresh();
  }, [search]);
  useEffect(() => {
    const unlisten = listen<{ notice?: string }>("dictation://history", (e) => {
      void refresh();
      if (e.payload.notice) setNotice(e.payload.notice);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [search]);
  const update = (patch: Partial<Config>) =>
    setConfig((c) => ({ ...c, ...patch }));
  return (
    <section aria-label="Voice typing">
      <h3>Voice typing</h3>
      <p>
        Audio stays in memory and is discarded. Language and vocabulary use the
        speech settings above.
      </p>
      <p>
        {prefs.stt_engine === "cloud"
          ? "Cloud speech: audio goes to your selected STT endpoint."
          : "Speech is processed locally."}{" "}
        {![undefined, "Automatic", "Ollama"].includes(prefs.provider)
          ? "Cloud AI: styled dictation goes to your selected AI provider."
          : prefs.provider === "Ollama"
            ? `Styled text goes to your Ollama endpoint: ${prefs.base_url ?? "http://localhost:11434"}.`
            : "AI cleanup uses your local engine."}
      </p>
      <label>
        Dictation hotkey
        <input
          value={config.hotkey}
          onChange={(e) => update({ hotkey: e.target.value })}
          onKeyDown={(e) => {
            if (
              !(e.ctrlKey || e.metaKey || e.altKey) ||
              ["Control", "Meta", "Alt", "Shift"].includes(e.key)
            )
              return;
            e.preventDefault();
            update({
              hotkey: [
                e.ctrlKey || e.metaKey ? "CommandOrControl" : "",
                e.altKey ? "Alt" : "",
                e.shiftKey ? "Shift" : "",
                e.code === "Space" ? "Space" : e.key.toUpperCase(),
              ]
                .filter(Boolean)
                .join("+"),
            });
          }}
        />
      </label>
      <label>
        Talk mode
        <select
          value={config.mode}
          onChange={(e) => update({ mode: e.target.value })}
        >
          <option value="toggle">Press to start / press to stop</option>
          <option value="hold">Hold to talk</option>
        </select>
      </label>
      <label>
        Dictation style
        <select
          value={config.style}
          onChange={(e) => update({ style: e.target.value })}
        >
          {["As spoken", "Clean", "Formal", "Bullet points"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <p>
        As spoken skips AI. If cleanup takes too long or is unavailable, the raw
        transcript is inserted.
      </p>
      {config.style !== "As spoken" && (
        <label>
          Style instructions
          <textarea
            value={config.prompts[config.style] ?? ""}
            placeholder="Leave empty for built-in instructions"
            onChange={(e) =>
              update({
                prompts: { ...config.prompts, [config.style]: e.target.value },
              })
            }
          />
        </label>
      )}
      <label>
        <input
          type="checkbox"
          checked={config.cues}
          onChange={(e) => update({ cues: e.target.checked })}
        />
        Start and stop cues
      </label>
      <h4>Dictionary replacements</h4>
      {config.replacements.map((r, i) => (
        <div key={i}>
          <input
            aria-label={`Spoken phrase ${i + 1}`}
            value={r.from}
            onChange={(e) =>
              update({
                replacements: config.replacements.map((rule, j) =>
                  j === i ? { ...rule, from: e.target.value } : rule,
                ),
              })
            }
          />
          <input
            aria-label={`Replacement ${i + 1}`}
            value={r.to}
            onChange={(e) =>
              update({
                replacements: config.replacements.map((rule, j) =>
                  j === i ? { ...rule, to: e.target.value } : rule,
                ),
              })
            }
          />
          <button
            onClick={() =>
              update({
                replacements: config.replacements.filter((_, j) => j !== i),
              })
            }
          >
            Remove replacement {i + 1}
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          update({
            replacements: [...config.replacements, { from: "", to: "" }],
          })
        }
      >
        Add replacement
      </button>
      <label>
        Dictation history retention days (0 disables history)
        <input
          type="number"
          min="0"
          max="36500"
          value={config.days}
          onChange={(e) => update({ days: Number(e.target.value) })}
        />
      </label>
      <button
        onClick={() =>
          void voice("save", config)
            .then(() => {
              setNotice("Dictation settings saved");
              void refresh();
            })
            .catch(fail)
        }
      >
        Save dictation settings
      </button>
      <button
        onClick={() =>
          void voice<typeof permissions>("permissions")
            .then(setPermissions)
            .catch(fail)
        }
      >
        Check permissions
      </button>
      {permissions && (
        <div aria-label="Dictation permissions">
          <p>{permissions.microphone}</p>
          <p>{permissions.paste}</p>
          <p>Microphones: {permissions.devices.join(", ") || "None found"}</p>
        </div>
      )}
      <button
        onClick={() =>
          void invoke("dictation_control", {
            action: "toggle",
            confirmed: false,
          }).catch(fail)
        }
      >
        Try dictation
      </button>
      {notice.includes("Meeting capture") && (
        <button
          onClick={() =>
            void invoke("dictation_control", {
              action: "toggle",
              confirmed: true,
            }).catch(fail)
          }
        >
          Confirm dictation alongside meeting capture
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      <h3>Dictation history</h3>
      <input
        aria-label="Search dictation history"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <button
        onClick={() => {
          if (window.confirm("Delete all dictation history?"))
            void voice("clear").then(refresh).catch(fail);
        }}
      >
        Clear dictation history
      </button>
      {history.length === 0 && <p>No dictations found.</p>}
      <ul>
        {history.map((entry) => (
          <li key={entry.id}>
            <time>{new Date(entry.created_at).toLocaleString()}</time>
            <p>{entry.text}</p>
            <button
              onClick={() =>
                void data("copy_text", { text: entry.text }).catch(fail)
              }
            >
              Copy dictation
            </button>
            <button
              onClick={() =>
                void voice("delete", { id: entry.id }).then(refresh).catch(fail)
              }
            >
              Delete dictation
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function DictationNotice() {
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    void voice<string | null>("notice")
      .then((n) => {
        if (n) setNotice(n);
      })
      .catch((e) => setNotice(String(e)));
  }, []);
  useEffect(() => {
    const history = listen<{ text: string; notice?: string }>(
      "dictation://history",
      (e) => {
        if (e.payload.notice) {
          setText(e.payload.text);
          setNotice(e.payload.notice);
        }
      },
    );
    return () => {
      void history.then((f) => f());
    };
  }, []);
  useEffect(() => {
    const sub = listen<{ state: string; notice?: string }>(
      "dictation://state",
      (e) => {
        if (e.payload.notice) setNotice(e.payload.notice);
      },
    );
    return () => {
      void sub.then((f) => f());
    };
  }, []);
  return notice ? (
    <div role="alert">
      {notice}
      {text && (
        <button
          onClick={() =>
            void data("copy_text", { text }).catch((e) => setNotice(String(e)))
          }
        >
          Copy last dictation
        </button>
      )}
      <button onClick={() => setNotice("")}>Dismiss dictation notice</button>
    </div>
  ) : null;
}
export function DictationIndicator() {
  const [state, setState] = useState("preparing");
  const [level, setLevel] = useState(-100);
  const [cue, setCue] = useState(false);
  const cancel = () =>
    void invoke("dictation_control", { action: "cancel", confirmed: false });
  useEffect(() => {
    const subs = [
      listen<{ state: string; cues?: boolean }>("dictation://state", (e) => {
        setState(e.payload.state);
        setCue(e.payload.cues ?? false);
        if (e.payload.cues) {
          const ctx = new AudioContext();
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0.06;
          oscillator.frequency.value =
            e.payload.state === "listening" ? 660 : 440;
          oscillator.connect(gain).connect(ctx.destination);
          oscillator.start();
          oscillator.stop(ctx.currentTime + 0.1);
          oscillator.onended = () => void ctx.close();
        }
      }),
      listen<number>("dictation://level", (e) => setLevel(e.payload)),
    ];
    void Promise.all(subs).then(() => voice("ready"));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    return () => {
      subs.forEach((s) => void s.then((f) => f()));
      window.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <section className="dictation-indicator" aria-label="Dictation indicator">
      {cue && (
        <span key={state} className="dictation-cue" aria-hidden="true">
          ●
        </span>
      )}
      <p role="status">
        {state === "listening"
          ? "Listening…"
          : state === "preparing"
            ? "Preparing…"
            : "Writing…"}
      </p>
      <meter min="-100" max="0" value={level} />
      <button
        onClick={() =>
          void invoke("dictation_control", { action: "stop", confirmed: false })
        }
      >
        Finish
      </button>
      <button onClick={cancel}>Cancel (Esc)</button>
    </section>
  );
}
