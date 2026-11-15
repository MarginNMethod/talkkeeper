import { useState } from "react";
import { invoke } from "./api";
import { OwnProvider, SetupFailure } from "./Setup";
import type { SetupState } from "./useSetup";
export function SetupCard({setup:s,systemAudio=true,showOffer=false}:{setup:SetupState;systemAudio?:boolean;showOffer?:boolean}) {
  const [own,setOwn] = useState(false);
  if (showOffer && !s.started && !s.aiReady) return <section className="setup-card"><p>Set up recording and AI notes</p><button onClick={s.run}>Get started</button></section>;
  if ((!s.started && !s.status?.pending) || s.dismissed) return s.mic !== "idle" && s.mic !== "hidden" ? <MicrophoneCheck setup={s} systemAudio={systemAudio} /> : null;
  if (s.status?.ai === "skipped") return <section className="setup-card">AI notes are off · <button onClick={()=>void invoke("setup_preference",{name:"ai_skipped",value:false}).then(s.run)}>Set up</button><MicrophoneCheck setup={s} systemAudio={systemAudio} /></section>;
  const checking = !s.paused && !s.aiReady && s.status?.ai === "checking";
  const total = s.status?.custom ? (s.plan?.whisper.approx_download_mb ?? 78)*1e6 : s.plan?.total_download_bytes ?? 0;
  const done = s.status?.custom ? Math.min(total,s.progress.DownloadSpeechModel?.completed ?? 0) : s.bytes;
  const percent = s.aiReady && s.speechReady ? 100 : checking ? 99 : Math.min(99, total ? done/total*100 : 0);
  const waiting = s.progress.Check?.message.startsWith("Waiting for");
  return <section className="setup-card" aria-label="Setup status">
    <h3>{s.aiReady && s.speechReady ? "✓ All set" : "Setting up TalkKeeper"}</h3>
    <progress aria-label="Setup progress" className={checking ? "checking" : ""} value={percent} max={100} /><span>{Math.round(percent)}%</span>
    {checking ? <><p role="status"><span className="setup-spinner" aria-hidden="true" />Checking your AI…</p><p>Trying out the AI model. This can take a few minutes on some computers.</p></> : <p>{s.paused ? `Download paused · ${(done/1e9).toFixed(1)} of ${(total/1e9).toFixed(1)} GB saved` : `${(done/1e9).toFixed(1)} of ${(total/1e9).toFixed(1)} GB · ${s.eta}`}</p>}
    <div role="status" aria-live="polite"><p>Notes · ready</p><p>Recording · {s.speechReady ? "ready" : s.error ? "needs attention" : s.progress.DownloadSpeechModel ? "downloading" : "waiting"}</p><p>AI notes · {s.aiReady ? "ready" : s.error ? "needs attention" : checking ? "almost ready" : s.progress.PullModel ? "downloading" : "waiting"}</p></div>
    {s.progress.Check?.message.startsWith("The download was damaged") && <SetupFailure error={s.progress.Check.message} retry={()=>void s.retryNow()} own={()=>setOwn(true)} />}
    {waiting && !s.paused && <p>Waiting for the internet. Your download is saved and will carry on by itself.</p>}
    {(!s.aiReady || !s.speechReady) && <button onClick={()=>s.paused ? s.run() : void s.pause()}>{s.paused ? "Resume" : "Pause"}</button>}
    {waiting && <button onClick={()=>void s.retryNow()}>Try now</button>}
    <details><summary>Details</summary>{["Computer check",`Speech model (${Math.round(s.plan?.whisper.approx_download_mb ?? 78)} MB)`,"note writer",`AI model: ${s.plan?.llm.friendly_name ?? ""} (${s.plan?.llm.approx_download_gb ?? 0} GB)`,"AI check"].map((label,i)=><p key={label}>{label} · {s.progress[["Check","SpeechReady","StartRuntime","PullModel","Verify"][i]]?.completed === s.progress[["Check","SpeechReady","StartRuntime","PullModel","Verify"][i]]?.total && !!s.progress[["Check","SpeechReady","StartRuntime","PullModel","Verify"][i]]?.total ? "ready" : s.progress[["Check","DownloadSpeechModel","DownloadRuntime","PullModel","Verify"][i]] ? "in progress" : "waiting"}</p>)}<p>{s.plan?.llm.license}. {s.plan?.llm.notes}</p><p>Needs the internet once. After that TalkKeeper works offline.</p><button onClick={()=>setOwn(true)}>I already have my own AI service (advanced)</button></details>
    {own && <OwnProvider onBack={()=>setOwn(false)} onSaved={()=>{setOwn(false);s.run();void s.refresh();}} />}
    {s.error && <SetupFailure plan={s.plan} error={s.error} retry={s.run} own={()=>setOwn(true)} skip={()=>void s.skipAI()} />}
    <MicrophoneCheck setup={s} systemAudio={systemAudio} />
    {s.aiReady && <button onClick={s.dismiss}>Dismiss</button>}
  </section>;
}

export function MicrophoneCheck({setup:s,systemAudio=true}:{setup:SetupState;systemAudio?:boolean}) {
  const {mic,setMic,micLevel:level,micWords:words,micDevice:device,checkMicrophone:check} = s;
  return <>    {s.speechReady && (!s.status?.mic_checked || (mic !== "idle" && mic !== "hidden")) && mic !== "hidden" && <section aria-label="Microphone check">
      {mic === "idle" && <><p>Recording is ready. Let's check your microphone.</p><p>Say a few words and watch them appear. Takes 10 seconds.</p><button onClick={()=>void check()}>Check my microphone</button><button onClick={()=>setMic("hidden")}>Not now</button></>}
      {mic === "permission" && <><p>Your computer will ask if TalkKeeper may use the microphone. Choose Allow.</p><p>Listening… say "Testing, one, two, three."</p><p>Microphone: {device}</p><meter aria-label="Microphone level" min={0} max={1} value={level} /><p>{words}</p><small>This test isn't saved.</small></>}
      {mic === "success" && <><p>Your microphone works. You're ready to record.</p>{!systemAudio && <p>This version records your microphone only, not the other people on a call. Use speakers, not headphones, so it can hear them.</p>}<button onClick={()=>setMic("hidden")}>Done</button></>}
      {mic === "denied" && <><p>TalkKeeper isn't allowed to use the microphone. Turn it on in your computer's privacy settings, then come back.</p><button onClick={()=>void invoke("open_microphone_settings")}>Open privacy settings</button><button onClick={()=>void check()}>Try again</button></>}
      {(mic === "silent" || mic === "no_device") && <><p>We can't hear anything. Check that your microphone isn't muted and is the one selected in your computer's sound settings.</p><button onClick={()=>void check()}>Try again</button><button onClick={()=>void invoke("open_microphone_settings")}>Open sound settings</button><button onClick={()=>setMic("hidden")}>Skip</button></>}
      {mic === "no_words" && <><p>We can hear you, but the words aren't coming through yet. This can be slow the first time.</p><button onClick={()=>void check()}>Try again</button><button onClick={()=>setMic("hidden")}>Skip</button></>}
    </section>}
</>;
}
