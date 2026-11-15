import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { MicrophoneSettingsButton } from "./CaptureFeedback";
import { data, invoke, type Preferences } from "./api";
export const voice = <T,>(action: string, payload: unknown = {}) =>
  invoke<T>("dictation_data", { action, payload });
export interface Config {
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
export function DictationSettings({
  prefs,
  onChange,
}: {
  prefs: Preferences;
  onChange?: (config: Config) => void;
}) {
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
  const update = (patch: Partial<Config>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    onChange?.(next);
  };
  return (
    <section aria-label="Voice typing">
      <h3>Voice typing</h3>
      <p>
        Audio stays in memory and is discarded. Language and vocabulary use the
        speech settings above.
      </p>
      <p>
        {prefs.stt_engine === "cloud"
          ? "Your audio is sent to your chosen online service."
          : "Speech is processed on this computer."}{" "}
        {![undefined, "Automatic", "Ollama"].includes(prefs.provider)
          ? "Your spoken text is sent to your chosen online AI service."
          : prefs.provider === "Ollama"
            ? "Your spoken text goes to the AI program you run yourself."
            : "AI tidying runs on this computer."}
      </p>
      <label>
        Keyboard shortcut
        <input
          value={config.hotkey.replace(
            "CommandOrControl",
            /Mac/.test(navigator.platform) ? "⌘" : "Ctrl",
          )}
          onChange={(e) =>
            update({
              hotkey: e.target.value.replace(/^(Ctrl|⌘)/, "CommandOrControl"),
            })
          }
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
        How the shortcut works
        <select
          value={config.mode}
          onChange={(e) => update({ mode: e.target.value })}
        >
          <option value="toggle">Press once to start, again to stop</option>
          <option value="hold">Hold down while speaking</option>
        </select>
      </label>
      <label>
        Tidy up what I say
        <select
          value={config.style}
          onChange={(e) => update({ style: e.target.value })}
        >
          {["As spoken", "Clean", "Formal", "Bullet points"].map((s) => (
            <option key={s} value={s}>
              {
                (
                  {
                    "As spoken": "Type exactly what I say",
                    Clean: "Clean up",
                    Formal: "Make it formal",
                    "Bullet points": "Turn into bullet points",
                  } as Record<string, string>
                )[s]
              }
            </option>
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
        Play a sound when starting and stopping
      </label>
      <h4>Words to replace</h4>
      {config.replacements.map((r, i) => (
        <div key={i}>
          <input
            aria-label={`When I say ${i + 1}`}
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
        Keep voice typing history for
        <select
          value={config.days}
          onChange={(e) => update({ days: Number(e.target.value) })}
        >
          {[
            [0, "Don't keep"],
            [7, "7 days"],
            [30, "30 days"],
            [365, "1 year"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {![0, 7, 30, 365].includes(config.days) && (
            <option value={config.days}>{config.days} days</option>
          )}
        </select>
      </label>
      {!onChange && (
        <button
          onClick={() =>
            void voice("save", config)
              .then(() => {
                setNotice("Voice typing settings saved");
                void refresh();
              })
              .catch(fail)
          }
        >
          Save voice typing settings
        </button>
      )}
      <button
        onClick={() =>
          void voice<typeof permissions>("permissions")
            .then(setPermissions)
            .catch(fail)
        }
      >
        Check it can work
      </button>
      {permissions && (
        <div aria-label="Voice typing permissions">
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
        Try voice typing
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
          Use voice typing while recording a meeting
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {notice.toLowerCase().includes("microphone") && (
        <MicrophoneSettingsButton onError={fail} />
      )}
      <h3>What you have said</h3>
      <input
        aria-label="Search what you have said"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <button
        onClick={() => {
          if (window.confirm("Delete all voice typing history?"))
            void voice("clear").then(refresh).catch(fail);
        }}
      >
        Delete all spoken text
      </button>
      {history.length === 0 && <p>Nothing yet.</p>}
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
              Copy spoken text
            </button>
            <button
              onClick={() =>
                void voice("delete", { id: entry.id }).then(refresh).catch(fail)
              }
            >
              Delete spoken text
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
      {notice.toLowerCase().includes("microphone") && (
        <MicrophoneSettingsButton onError={(e) => setNotice(String(e))} />
      )}
      {text && (
        <button
          onClick={() =>
            void data("copy_text", { text }).catch((e) => setNotice(String(e)))
          }
        >
          Copy last spoken text
        </button>
      )}
      <button onClick={() => setNotice("")}>Dismiss voice typing notice</button>
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
    <section
      className="dictation-indicator"
      aria-label="Voice typing indicator"
    >
      {cue && (
        <span key={state} className="dictation-cue" aria-hidden="true">
          ●
        </span>
      )}
      <p role="status">
        {state === "listening"
          ? "Listening…"
          : state === "preparing"
            ? "Getting ready…"
            : "Typing…"}
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
