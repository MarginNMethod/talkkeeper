import { Modal } from "./Modal";
import { getTheme, setTheme, type Theme } from "./theme";
import { CopyDiagnostics } from "./CopyDiagnostics";
import { McpSettings } from "./McpSettings";
import { CalendarSettings } from "./Calendar";
import { DictationSettings, type Config } from "./Dictation";
import { useEffect, useState } from "react";
import { data, invoke, type Preferences } from "./api";
const languages: Record<string, string> = {
  auto: "Detect automatically",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  hi: "Hindi",
  ar: "Arabic",
};
export function Settings({
  initial,
  onClose,
  onError,
}: {
  initial: Preferences;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [appearance, setAppearance] = useState<Theme>(getTheme);
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [voiceConfig, setVoiceConfig] = useState<Config | null>(null);
  const [voiceVersion, setVoiceVersion] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [baseline, setBaseline] = useState(initial);
  async function save() {
    setBusy(true);
    try {
      if (voiceConfig)
        await invoke("dictation_data", {
          action: "save",
          payload: voiceConfig,
        });
      if (key) await data("set_key", { key, name: "llm" });
      if (sttKey) await data("set_key", { key: sttKey, name: "stt" });
      await data("save_settings", prefs);
      setBaseline(prefs);
      setVoiceConfig(null);
      setKey("");
      setSttKey("");
      setConfirm(false);
      setSaved(true);
      if (leaving) onClose();
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const [models, setModels] = useState<{ id: string; display_name: string }[]>(
    [],
  );
  const [key, setKey] = useState("");
  const [sttKey, setSttKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [speechModels, setSpeechModels] = useState<
    { name: string; size: number }[]
  >([]);
  useEffect(() => {
    void data<{ name: string; size: number }[]>("speech_models")
      .then((m) => setSpeechModels(m ?? []))
      .catch(onError);
  }, []);
  const field = (name: keyof Preferences, value: unknown) =>
    setPrefs((p) => ({ ...p, [name]: value }));
  const dirty =
    JSON.stringify(prefs) !== JSON.stringify(baseline) ||
    !!voiceConfig ||
    !!key ||
    !!sttKey;
  async function loadModels() {
    setBusy(true);
    try {
      setModels(
        (await invoke<{ id: string; display_name: string }[]>("list_models")) ??
          [],
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings">
      <h2>Settings</h2>
      <section aria-label="General"><h3>General</h3><label>Appearance<select value={appearance} onChange={e => { const choice = e.target.value as Theme; setAppearance(choice); setTheme(choice); }}>{(["light", "dark", "system"] as const).map(choice => <option key={choice} value={choice}>{choice[0].toUpperCase() + choice.slice(1)}</option>)}</select></label><p>Choose a theme, or follow your computer.</p></section>
      <section aria-label="Recording">
        <h3>Recording and speech</h3>
        <p>Automatic selection prefers the built-in microphone on macOS. Choose a microphone in the recording bar.</p>{" "}
        <label>
          Language spoken in your meetings
          <select
            value={prefs.language ?? "auto"}
            onChange={(e) => field("language", e.target.value)}
          >
            {Object.entries(languages).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {prefs.language && !languages[prefs.language] && (
              <option value={prefs.language}>{prefs.language}</option>
            )}
          </select>
        </label>
        <label>
          Names and unusual words
          <textarea
            value={prefs.vocabulary?.join(", ") ?? ""}
            onChange={(e) =>
              field(
                "vocabulary",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <label>
          Take pictures of my screen during meetings
          <select
            value={prefs.snapshots_preference ?? "Ask each time"}
            onChange={(e) => field("snapshots_preference", e.target.value)}
          >
            {["Ask each time", "Always on", "Never"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <p>
          Always on uses the window in front on your main screen after your
          first confirmation. Screen images may contain private information.
        </p>
      </section>
      <section aria-label="Calendar">
        <CalendarSettings onError={onError} prefs={prefs} onChange={field} />
      </section>
      <DictationSettings
        key={voiceVersion}
        prefs={prefs}
        onChange={setVoiceConfig}
      />
      <section aria-label="Privacy and storage">
        <h3>Privacy and storage</h3>
        <p>
          {![undefined, "Automatic", "Ollama"].includes(prefs.provider) ||
          prefs.stt_engine === "cloud"
            ? "Uses an online service you chose."
            : "Everything stays on this computer."}
        </p>{" "}
        {(
          [
            [
              "snapshot_retention",
              "Keep screen pictures for",
              "After this, pictures taken of your screen during a meeting are deleted.",
            ],
            [
              "retention",
              "Keep transcripts for",
              "After this, the word-for-word transcript is deleted. Your notes and summaries are always kept.",
            ],
          ] as const
        ).map(([key, label, hint]) => (
          <div key={key}>
            <label>
              {label}
              <select
                value={prefs[key] ?? 0}
                onChange={(e) => field(key, Number(e.target.value))}
              >
                {[
                  [0, "Keep forever"],
                  [365, "1 year"],
                  [90, "90 days"],
                  [30, "30 days"],
                ].map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
                {prefs[key] !== undefined &&
                  ![0, 365, 90, 30].includes(prefs[key]!) && (
                    <option value={prefs[key]}>{prefs[key]} days</option>
                  )}
              </select>
            </label>
            <p>{hint}</p>
          </div>
        ))}
        <label>
          Message to ask for permission
          <textarea
            value={
              prefs.notice ??
              "I would like to record and transcribe this conversation for my notes. Does everyone consent?"
            }
            onChange={(e) => field("notice", e.target.value)}
          />
        </label>
      </section>
      <section aria-label="AI"><h3>AI</h3>
      <details>
        <summary>Advanced</summary>
        <p>
          Most people never need these. TalkKeeper chooses sensible settings
          during setup.
        </p>
        <details>
          <summary>AI that writes your summaries</summary>
          <label>
            Where summaries are written
            <select
              value={prefs.provider ?? "Automatic"}
              onChange={(e) => {
                field("provider", e.target.value);
                field("model", "");
                setModels([]);
              }}
            >
              {[
                "Automatic",
                "Ollama",
                "Anthropic",
                "OpenAI",
                "OpenAICompatible",
              ].map((p) => (
                <option key={p} value={p}>
                  {(
                    {
                      Automatic: "On this computer (recommended)",
                      Ollama: "An AI program I run myself",
                      OpenAICompatible: "Another compatible service",
                    } as Record<string, string>
                  )[p] ?? p}
                </option>
              ))}
            </select>
          </label>
          {prefs.provider !== undefined && prefs.provider !== "Automatic" && (
            <>
              <label>
                Service address
                <input
                  value={prefs.base_url ?? "http://localhost:11434"}
                  onChange={(e) => field("base_url", e.target.value)}
                />
              </label>
            </>
          )}
          {![undefined, "Automatic", "Ollama"].includes(prefs.provider) && (
            <>
              <label>
                Secret key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>

              <button
                onClick={() =>
                  void data("clear_key", { name: "llm" }).catch(onError)
                }
              >
                Remove key
              </button>
              <p>
                Stored in your computer’s password manager. Removing a key
                applies straight away.
              </p>
            </>
          )}
          <button disabled={busy} onClick={() => void loadModels()}>
            Refresh list
          </button>
          <label>
            AI model
            <select
              aria-label="AI model"
              value={prefs.model ?? ""}
              onChange={(e) => field("model", e.target.value)}
            >
              <option value="">Choose one</option>
              {prefs.model && !models.some((m) => m.id === prefs.model) && (
                <option>{prefs.model}</option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
        </details>
        <details>
          <summary>Turning speech into text</summary>
          <label>
            Where speech is turned into text
            <select
              value={prefs.stt_engine ?? "local"}
              onChange={(e) => field("stt_engine", e.target.value)}
            >
              <option value="local">On this computer (recommended)</option>
              <option value="cloud">An online service</option>
            </select>
          </label>
          <label>
            Accuracy
            {(prefs.stt_engine ?? "local") === "local" ? (
              <select
                aria-label="Accuracy"
                value={prefs.stt_model ?? ""}
                onChange={(e) => field("stt_model", e.target.value)}
              >
                <option value="">Choose a speech model</option>
                {speechModels.map((m) => (
                  <option key={m.name} value={m.name} title={m.name}>
                    {m.size < 200000000
                      ? "Faster"
                      : m.size < 1000000000
                        ? "Balanced"
                        : "Most accurate"}{" "}
                    ({Math.round(m.size / 1000000)} MB)
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={prefs.stt_model ?? ""}
                onChange={(e) => field("stt_model", e.target.value)}
              />
            )}
          </label>
          {(prefs.stt_engine ?? "local") === "local" && (
            <button
              onClick={() =>
                void invoke("download_model", { name: prefs.stt_model }).catch(
                  onError,
                )
              }
            >
              Download
            </button>
          )}
          {prefs.stt_engine === "cloud" && (
            <>
              <label>
                Speech service address
                <input
                  value={prefs.stt_url ?? ""}
                  onChange={(e) => field("stt_url", e.target.value)}
                />
              </label>
              <label>
                Speech secret key
                <input
                  type="password"
                  value={sttKey}
                  onChange={(e) => setSttKey(e.target.value)}
                />
              </label>

              <button
                onClick={() =>
                  void data("clear_key", { name: "stt" }).catch(onError)
                }
              >
                Remove speech key
              </button>
            </>
          )}
        </details>
      </details>
      </section>
      <section aria-label="Connections"><h3>Connections</h3>
        <details>
          <summary>Let other AI apps read your notes</summary>
          <McpSettings onError={onError} />
        </details>
      </section>
      <section aria-label="About"><h3>About</h3><p>TalkKeeper · A place for your conversations.</p><CopyDiagnostics /></section>
      <footer className="settings-footer">
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() => {
            const before = baseline.retention ?? 0,
              after = prefs.retention ?? 0;
            if (after > 0 && (before === 0 || after < before)) setConfirm(true);
            else void save();
          }}
        >
          Save changes
        </button>
        <button
          className="quiet"
          onClick={() => {
            setPrefs(baseline);
            setVoiceConfig(null);
            setVoiceVersion((v) => v + 1);
            setKey("");
            setSttKey("");
          }}
        >
          Discard changes
        </button>
        {saved && <span role="status">Saved</span>}
        <button
          className="quiet"
          onClick={() => {
            if (
              JSON.stringify(prefs) !== JSON.stringify(baseline) ||
              voiceConfig ||
              key ||
              sttKey
            )
              setLeaving(true);
            else onClose();
          }}
        >
          Close
        </button>
      </footer>
      {leaving && !confirm && (
        <Modal onClose={() => setLeaving(false)} role="dialog" aria-label="Save your changes?">
          <h3>Save your changes?</h3>
          <button
            className="primary"
            onClick={() => {
              const before = baseline.retention ?? 0,
                after = prefs.retention ?? 0;
              if (after > 0 && (before === 0 || after < before))
                setConfirm(true);
              else void save();
            }}
          >
            Apply changes
          </button>
          <button onClick={onClose}>Discard</button>
          <button onClick={() => setLeaving(false)}>Keep editing</button>
        </Modal>
      )}
      {confirm && (
        <Modal onClose={() => setConfirm(false)} role="alertdialog" aria-label="Delete older transcripts?">
          <h3>Delete older transcripts?</h3>
          <p>
            Transcripts older than {prefs.retention} days will be deleted now.
            Your notes and summaries are kept. This cannot be undone.
          </p>
          <button className="primary danger" onClick={() => void save()} disabled={busy}>
            Confirm and apply
          </button>
          <button onClick={() => setConfirm(false)}>Cancel</button>
        </Modal>
      )}
    </section>
  );
}
