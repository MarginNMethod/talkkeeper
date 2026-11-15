import { useEffect, useRef, useState } from "react";
import { data, invoke, type Preferences } from "./api";
import { useSetup, type SetupState, type Plan } from "./useSetup";
export function Setup(props: {setup:SetupState;onStart:()=>void} | {onReady:()=>void;onAdvanced:()=>void}) {
  return "setup" in props ? <SetupPanel {...props} /> : <RepairSetup onReady={props.onReady} />;
}
function RepairSetup({onReady}:{onReady:()=>void}) {
  const setup = useSetup();
  return <SetupPanel setup={setup} onStart={onReady} />;
}
function SetupPanel({ setup, onStart }: { setup: SetupState; onStart: () => void }) {
  const [own, setOwn] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(setup.plan?.can_install && document.activeElement === document.body) primary.current?.focus();},[setup.plan]);
  return <section className="empty setup-welcome" aria-label="Automatic setup">
    {own ? <OwnProvider onBack={() => setOwn(false)} onSaved={() => { setup.run(); void setup.refresh(); onStart(); }} /> : <>
      <h2>Welcome to TalkKeeper</h2>
      <p>TalkKeeper listens to your meetings, writes down what was said, and turns it into tidy notes. Everything stays on this computer.</p>
      <button ref={primary} className="primary" autoFocus disabled={!setup.plan?.can_install} onClick={() => { setup.run(); onStart(); }}>Get started</button>
      <p>{setup.plan ? `Downloads ${(setup.plan.total_download_bytes/1e9).toFixed(1)} GB in the background. You can start taking notes right away.` : "Checking your computer…"}</p>
      {setup.plan?.notice && <p>{setup.plan.notice}</p>}
      {setup.plan && !setup.plan.can_install && <><SetupFailure error={/memory/i.test(setup.plan.notice ?? "") ? "memory" : "storage"} plan={setup.plan} retry={()=>void setup.loadPlan()} own={()=>setOwn(true)} skip={()=>{void setup.skipAI();onStart();}} /><button onClick={() => void setup.loadPlan()}>Check again</button></>}
      {setup.error && <SetupFailure error={setup.error} retry={setup.run} own={() => setOwn(true)} skip={()=>{void setup.skipAI();onStart();}} />}
      <a href="#own-provider" onClick={e => { e.preventDefault(); setOwn(true); }}>I already have my own AI provider</a>
    </>}
  </section>;
}
export function OwnProvider({onBack,onSaved}:{onBack:()=>void;onSaved:()=>void}) {
  const [prefs,setPrefs] = useState<Preferences>({provider:"Ollama",base_url:"http://localhost:11434",model:""});
  const [confirm,setConfirm] = useState<number | null>(null);
  const [key,setKey] = useState(""); const [models,setModels] = useState<{id:string}[]>([]); const [message,setMessage] = useState(""); const [busy,setBusy] = useState(false);
  async function test() { setBusy(true); setModels([]); try { const result = await invoke<{id:string}[]>("setup_test_provider",{prefs,key}); setModels(result); setMessage(`Connected. ${result.length} models found.`); } catch(e) { setMessage(String(e).includes("401") ? "The provider refused that key." : "Couldn't reach that address. Check it's running and the address is right."); } finally { setBusy(false); } }
  async function save(confirmed=false) {
    setBusy(true);
    try {
      const state = await invoke<{running:boolean;progress:Record<string,{completed:number}>}>("setup_progress");
      if(state?.running && !confirmed) {
        setConfirm(Object.values(state.progress ?? {}).reduce((n,p)=>n+p.completed,0));return;
      }
      if(state?.running) await invoke("setup_cancel");
      const old = await data<Preferences>("settings");
      if(key) await data("set_key",{name:"llm",key});
      await data("save_settings",{...old,...prefs});
      await invoke("setup_remove_ai_download");
      setConfirm(null);onSaved();
    } catch {setMessage("TalkKeeper can't save files. Check there is free space and that you're allowed to save to this computer.");}
    finally {setBusy(false);}
  }
  return <section><h2>Use your own AI provider</h2><p>For people who already run an AI service or have an API key. If that's not you, go back and choose Get started.</p>
    <label>Provider<select value={prefs.provider} onChange={e=>{setPrefs({...prefs,provider:e.target.value,model:""});setModels([]);}}>{["Ollama","OpenAICompatible","OpenAI","Anthropic"].map(p=><option key={p} value={p}>{p === "Ollama" ? "Ollama on this computer" : p}</option>)}</select></label>
    <label>Address<input value={prefs.base_url} onChange={e=>{setPrefs({...prefs,base_url:e.target.value});setModels([]);}} /></label>
    {prefs.provider !== "Ollama" && <><label>API key<input type="password" value={key} onChange={e=>{setKey(e.target.value);setModels([]);}} /></label><p>Your notes and transcripts will be sent to this provider to write AI notes.</p></>}
    <button disabled={busy} onClick={()=>void test()}>Test connection</button><p role="status">{message}</p>
    <label>AI model<select value={prefs.model} onChange={e=>setPrefs({...prefs,model:e.target.value})}><option value="">Choose a model</option>{models.map(m=><option key={m.id}>{m.id}</option>)}</select></label>
    <label><input type="checkbox" checked disabled />Still download the small speech model (78 MB) so recording works on this computer</label>
    {confirm !== null && <section role="dialog" aria-label="Stop downloading the built-in AI model?"><p>Stop downloading the built-in AI model? The {(confirm/1e9).toFixed(1)} GB already downloaded will be removed.</p><button onClick={()=>void save(true)}>Stop and remove</button><button onClick={()=>setConfirm(null)}>Keep downloading</button></section>}
    <button disabled={busy || !models.length || !prefs.model} onClick={()=>void save()}>Save and continue</button><button onClick={onBack}>Back</button>
  </section>;
}
const failures = [
  [/^downloads are blocked|^blocked$|network filter|^something is blocking/i,"Something is blocking the download","A firewall or network filter is stopping TalkKeeper. If you're on a work or school network, try another one.","Try again"],
  [/too little memory|^memory$/i,"This computer can't run the built-in AI","It has too little memory. Recording and transcripts still work. For AI notes, connect your own AI provider.",""],
  [/^not enough storage|^storage$|^disk$/i,"Not enough free space","Free up space on this computer, then try again.","Try again"],
  [/engine.*start/i,"The AI engine didn't start","Quit other AI apps if any are open, then try again.","Try again"],
  [/integrity|archive|damaged/i,"The download was damaged","We'll fetch that part again. Nothing else is lost.","Download again"],
  [/catalog/i,"This copy of TalkKeeper is damaged","Download and install it again.",""],
  [/platform|unavailable/i,"The built-in AI isn't available on this computer","Recording and transcripts still work. For AI notes, connect your own AI provider.",""],
  [/answer/i,"The AI model isn't answering","Your computer may be busy. Close some apps, then try again.","Try again"],
  [/speech/i,"The speech model didn't download","Recording needs this small file (78 MB).","Try again"],
  [/write|files/i,"TalkKeeper can't save files","Check there is free space and that you're allowed to save to this computer.","Try again"],
  [/./,"Waiting for the internet","Your download is saved and will carry on by itself.","Try now"],
] as const;
export function SetupFailure({error,retry,own,skip,plan}:{error:string;retry:()=>void;own:()=>void;skip?:()=>void;plan?:Plan | null}) {
  const row = failures.find(([pattern])=>pattern.test(error))!;
  const need = (plan?.total_download_bytes ?? 0)*1.3/1e9;
  const have = (plan?.hardware.free_disk_bytes ?? 0)/1e9;
  const body = row[1] === "Not enough free space" && plan ? `TalkKeeper needs ${need.toFixed(1)} GB free and this computer has ${have.toFixed(1)} GB. Free up ${Math.max(0,need-have).toFixed(1)} GB, then try again.` : row[2];
  const allowOwn = /memory|platform|unavailable|space|storage|answer/i.test(error);
  return <div role="alert"><h3>{row[1]}</h3><p>{body}</p><p>You can keep recording and taking notes meanwhile.</p>{row[3] && <button onClick={retry}>{row[3]}</button>}{allowOwn && <button onClick={own}>Use my own AI provider</button>}{skip && /memory|platform|unavailable/i.test(error) && <button onClick={skip}>Continue without AI notes</button>}<details><summary>Technical details</summary>{error}</details></div>;
}
