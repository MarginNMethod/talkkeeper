import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./api";
export interface Plan {
  llm: { friendly_name: string; approx_download_gb: number; license: string; notes: string };
  whisper: { approx_download_mb: number };
  total_download_bytes: number;
  hardware: { free_disk_bytes: number };
  notice: string | null;
  can_install: boolean;
}
export interface Progress { stage: string; completed: number; total: number; message: string }
export interface Readiness { completed: boolean; custom: boolean; pending?: boolean; paused?: boolean; speech?: string; ai?: string; mic_checked?: boolean; card_dismissed?: boolean; quit_confirmed?: boolean }
export function useSetup() {
  const [status, setStatus] = useState<Readiness | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [writingNote,setWritingNote] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [justCompleted,setJustCompleted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [mic, setMic] = useState("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [micWords, setMicWords] = useState("");
  const [micDevice, setMicDevice] = useState("");
  const [quitRequested, setQuitRequested] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const readyToQuit = useRef(false);
  const micPending = useRef<Promise<string> | null>(null);
  const samples = useRef<{ time: number; bytes: number }[]>([]);
  const [eta, setEta] = useState("working out time left…");
  const refresh = () => invoke<Readiness>("setup_status").then(s => { setStatus(s); setDismissed(!!s.card_dismissed); setStarted(!!s.pending); setPaused(!!s.paused); setStatusError(false); }).catch(() => setStatusError(true));
  const loadPlan = () => invoke<Plan>("setup_plan").then(setPlan).catch(e => setError(String(e).replace(/^Error: /, "")));
  useEffect(() => {
    void refresh(); void loadPlan();

    void invoke<{progress: Record<string, Progress>; running: boolean}>("setup_progress").then(p => { if (p?.progress) setProgress(old=>({...p.progress,...old})); if (p?.running) setStarted(true); }).catch(() => {});
    const listeners = [
      listen<{note_id:string;active:boolean}>("setup://writing",({payload})=>setWritingNote(payload.active ? payload.note_id : null)),
      listen<{level:number; text?:string; device?:string}>("setup://microphone", ({payload}) => {
        setMicLevel(payload.level); if(payload.text) setMicWords(payload.text); if(payload.device) setMicDevice(payload.device);
      }),
      listen<Progress>("setup://progress", ({payload: p}) => { setStarted(true); setProgress(old => {
        const previous = old[p.stage];
        const preserve = ["DownloadSpeechModel","DownloadRuntime","PullModel"].includes(p.stage) && previous && p.total !== 1 && p.completed < previous.completed;
        return {...old,[p.stage]:preserve ? previous : p};
      }); if (p.stage === "SpeechReady") setStatus(s => ({...s!, speech:"ready"})); setStatus(s => ({...s!, ai: s?.completed || s?.custom ? s.ai : p.stage === "Verify" ? "checking" : "downloading"})); }),
      listen<string>("setup://unlocked", ({payload}) => { if(payload === "ai") setJustCompleted(true); setStatus(s => ({...s!, [payload === "speech" ? "speech" : "ai"]:"ready", completed:payload === "ai" || !!s?.completed})); }),
      listen<string>("setup://error", ({payload}) => setError(payload.replace(/^Error: /,""))),
    ];
    return () => { for (const listener of listeners) void listener.then(f => f()); };
  }, []);
  useEffect(() => {
    if (status !== null) return;
    const timer = setTimeout(() => setStatusError(true), 5000);
    return () => clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    let dispose: (()=>void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/window").then(async ({getCurrentWindow}) => {
      const unlisten = await getCurrentWindow().onCloseRequested(event => {
        if (!readyToQuit.current && started && !status?.completed && !status?.quit_confirmed) {
          event.preventDefault(); setQuitRequested(true);
        }
      });
      if(cancelled) unlisten(); else dispose = unlisten;
    }).catch(()=>{});
    return () => { cancelled = true; dispose?.(); };
  }, [started,status?.completed,status?.quit_confirmed]);
  async function quit() {
    await invoke("setup_preference", {name:"quit_confirmed",value:dontAsk});
    readyToQuit.current = true;
    const {getCurrentWindow} = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }
  function checkMicrophone() {
    if(micPending.current) return micPending.current;
    setMic("permission");setMicWords("");setMicLevel(0);
    const pending = invoke<string>("setup_check_microphone").then(async result => {
      setMic(result);
      if(result === "success") { await invoke("setup_mic_checked"); setStatus(s=>({...s!,mic_checked:true})); }
      return result;
    }).catch(()=>{setMic("denied");return "denied";}).finally(()=>{micPending.current=null;});
    micPending.current=pending;return pending;
  }
  function startAnyway() {setStatusError(false);setStatus({completed:false,custom:false,speech:"missing",ai:"missing"});}
  function dismiss() {setDismissed(true);void invoke("setup_preference",{name:"card_dismissed",value:true});}
  async function skipAI() { await pause(); await invoke("setup_preference",{name:"ai_skipped",value:true});run();await refresh(); }
  async function retryNow() { await pause();run(); }
  const speechReady = status?.speech === "ready" || !!status?.completed;
  const aiReady = status?.ai === "ready" || status?.ai === "custom" || !!status?.completed || !!status?.custom;
  const bytes = Object.values(progress).filter(p => ["DownloadSpeechModel","DownloadRuntime","PullModel"].includes(p.stage)).reduce((sum,p) => {
    const size = p.stage === "DownloadSpeechModel" ? (plan?.whisper.approx_download_mb ?? 78)*1e6 : p.stage === "PullModel" ? (plan?.llm.approx_download_gb ?? 0)*1e9 : Math.max(0,(plan?.total_download_bytes ?? 0)-(plan?.whisper.approx_download_mb ?? 78)*1e6-(plan?.llm.approx_download_gb ?? 0)*1e9);
    return sum + (p.completed === 1 && p.total === 1 ? size : Math.min(p.completed, size));
  },0);
  useEffect(() => {
    function estimate() {
      const now = Date.now(); const history = samples.current;
      history.push({time:now,bytes});
      while (history.length > 1 && history[1].time < now-30000) history.shift();
      const elapsed = now-history[0].time;
      const speed = elapsed > 0 ? (bytes-history[0].bytes)/(elapsed/1000) : 0;
      if (elapsed < 10000 || speed <= 0) { setEta("working out time left…"); return; }
      const mins = Math.max(0,Math.ceil(((plan?.total_download_bytes ?? 0)-bytes)/speed/60));
      const rounded = Math.round(mins/10)*10;
      setEta(mins < 1 ? "less than a minute" : mins < 60 ? `about ${mins} min left` : `about ${Math.floor(rounded/60)} hr ${rounded%60} min left`);
    }
    estimate();
    const timer = setInterval(estimate,1000);
    return () => clearInterval(timer);
  },[bytes,plan]);
  function run() {
    samples.current=[];
    setDismissed(false);
    setStarted(true); setPaused(false); setError("");
    void invoke("setup_run").then(refresh).catch(e => { const message = String(e).replace(/^Error: /,""); if (!message.includes("paused")) setError(message); });
  }
  async function pause() { setPaused(true); await invoke("setup_cancel"); }
  return { startAnyway, writingNote, justCompleted, setJustCompleted, status, statusError, refresh, plan, loadPlan, progress, error, paused, started, setStarted, dismissed, setDismissed, dismiss, skipAI, retryNow, mic, setMic, micLevel, micWords, micDevice, checkMicrophone, quitRequested, setQuitRequested, dontAsk, setDontAsk, quit, speechReady, aiReady, bytes, eta, run, pause };
}
export type SetupState = ReturnType<typeof useSetup>;
