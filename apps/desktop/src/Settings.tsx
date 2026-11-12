import { DictationSettings } from "./Dictation";
import { useEffect, useState } from "react";
import { data, invoke, type Preferences } from "./api";
export function Settings({
  initial,
  onClose,
  onError,
}: {
  initial: Preferences;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [prefs, setPrefs] = useState<Preferences>(initial);
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
  async function loadModels() {
    setBusy(true);
    try {
      await data("save_settings", prefs);
      setModels(await invoke("list_models"));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings">
      <h2>Settings</h2>
      <DictationSettings prefs={prefs} />
      <p>
        Cloud providers send notes or audio to the endpoint you select. Local
        processing uses Ollama and a downloaded speech model.
      </p>
      <label>
        AI provider (Advanced)
        <select
          value={prefs.provider ?? "Automatic"}
          onChange={(e) => {
            field("provider", e.target.value);
            field("model", "");
            setModels([]);
          }}
        >
          {["Automatic", "Ollama", "Anthropic", "OpenAI", "OpenAICompatible"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Base URL
        <input
          value={prefs.base_url ?? "http://localhost:11434"}
          onChange={(e) => field("base_url", e.target.value)}
        />
      </label>
      <label>
        AI API key
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button
        onClick={() =>
          void data("set_key", { key, name: "llm" })
            .then(() => setKey(""))
            .catch(onError)
        }
      >
        Store key in keychain
      </button>
      <button
        onClick={() => void data("clear_key", { name: "llm" }).catch(onError)}
      >
        Clear key
      </button>
      <button disabled={busy} onClick={() => void loadModels()}>
        Load models
      </button>
      <label>
        AI model
        <select
          aria-label="AI model"
          value={prefs.model ?? ""}
          onChange={(e) => field("model", e.target.value)}
        >
          <option value="">Choose a model</option>
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
      <label>
        Speech engine
        <select
          value={prefs.stt_engine ?? "local"}
          onChange={(e) => field("stt_engine", e.target.value)}
        >
          <option value="local">Local whisper.cpp</option>
          <option value="cloud">Cloud compatible STT</option>
        </select>
      </label>
      <label>
        Speech model
        {(prefs.stt_engine ?? "local") === "local" ? (
          <select
            aria-label="Speech model"
            value={prefs.stt_model ?? ""}
            onChange={(e) => field("stt_model", e.target.value)}
          >
            <option value="">Choose a speech model</option>
            {speechModels.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} ({Math.round(m.size / 1000000)} MB)
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
      <button
        onClick={() =>
          void invoke("download_model", { name: prefs.stt_model }).catch(
            onError,
          )
        }
      >
        Download speech model
      </button>
      <label>
        STT endpoint
        <input
          value={prefs.stt_url ?? ""}
          onChange={(e) => field("stt_url", e.target.value)}
        />
      </label>
      <label>
        STT API key
        <input
          type="password"
          value={sttKey}
          onChange={(e) => setSttKey(e.target.value)}
        />
      </label>
      <button
        onClick={() =>
          void data("set_key", { name: "stt", key: sttKey })
            .then(() => setSttKey(""))
            .catch(onError)
        }
      >
        Store speech key
      </button>
      <button
        onClick={() => void data("clear_key", { name: "stt" }).catch(onError)}
      >
        Clear speech key
      </button>
      <label>
        Language
        <input
          value={prefs.language ?? "auto"}
          onChange={(e) => field("language", e.target.value)}
        />
      </label>
      <label>
        Vocabulary (comma separated)
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
        Transcript retention days
        <input
          type="number"
          min="0"
          max="36500"
          value={prefs.retention ?? 30}
          onChange={(e) => field("retention", Number(e.target.value))}
        />
      </label>
      <label>
        Participant notice
        <textarea
          value={
            prefs.notice ??
            "I would like to record and transcribe this conversation for my notes. Does everyone consent?"
          }
          onChange={(e) => field("notice", e.target.value)}
        />
      </label>
      <button
        onClick={() =>
          void data("save_settings", prefs).then(onClose).catch(onError)
        }
      >
        Save settings
      </button>
      <button onClick={onClose}>Close</button>
    </section>
  );
}
