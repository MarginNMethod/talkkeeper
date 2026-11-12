import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./api";
interface Plan {
  llm: { friendly_name: string; approx_download_gb: number; license: string; notes: string };
  whisper: { approx_download_mb: number };
  total_download_bytes: number;
  hardware: { os: string; total_ram_bytes: number; free_disk_bytes: number };
  notice: string | null;
  can_install: boolean;
}
interface Progress { stage: string; completed: number; total: number; percent: number | null; message: string }
const stages: Record<string, string> = { Check: "Computer check", DownloadRuntime: "AI engine", StartRuntime: "Starting AI", PullModel: "AI model", DownloadSpeechModel: "Speech model", Verify: "Final check" };
export function Setup({ onReady, onAdvanced }: { onReady: () => void; onAdvanced: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  useEffect(() => { void invoke<Plan>("setup_plan").then(setPlan).catch((e: unknown) => setError(String(e))); }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(onReady, 1500);
    return () => clearTimeout(timer);
  }, [ready, onReady]);
  async function run() {
    setBusy(true); setError(""); setProgress({});
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<Progress>("setup://progress", ({ payload }) => setProgress((p) => ({ ...p, [payload.stage]: payload })));
      await invoke("setup_run"); setReady(true);
    } catch (e) { setError(String(e)); }
    finally { unlisten?.(); setBusy(false); }
  }
  return <section className="empty" aria-label="Automatic setup">
    <h2>{ready ? "You're ready" : "Make room for the conversation"}</h2>
    <p>TalkKeeper runs AI on your computer so your meetings stay private.</p>
    {ready ? <button onClick={onReady}>Create your first note</button> : <>
      {plan && <>
        <p>We'll download about {(plan.total_download_bytes / 1e9).toFixed(1)} GB: the local AI engine, {plan.llm.friendly_name} ({plan.llm.approx_download_gb} GB) chosen for your {plan.hardware.os === "macos" ? "Mac" : "computer"}, and a speech model ({Math.round(plan.whisper.approx_download_mb)} MB).</p>
        <p>{Math.round(plan.hardware.total_ram_bytes / 2 ** 30)} GB memory · {(plan.hardware.free_disk_bytes / 1e9).toFixed(1)} GB storage available</p>
        {plan.notice && <p role="status">{plan.notice}</p>}
        <details><summary>About this AI model</summary><p>{plan.llm.license}. {plan.llm.notes}</p></details>
      </>}
      {error && <p role="alert">{error}</p>}
      {Object.entries(stages).map(([stage, label]) => progress[stage] && <div key={stage}><label>{label}<progress aria-label={label} max={100} value={progress[stage].percent ?? undefined} /></label><p>{progress[stage].message}</p></div>)}
      {busy ? <button onClick={() => void invoke("setup_cancel").catch((e: unknown) => setError(String(e)))}>Cancel setup</button> : <button disabled={!plan?.can_install} onClick={() => void run()}>{error ? "Retry setup" : "Set up automatically"}</button>}
      <button disabled={busy} onClick={onAdvanced}>Use my own AI provider instead</button>
      <p>Downloads need an internet connection once. After setup, local AI works offline.</p>
    </>}
  </section>;
}
