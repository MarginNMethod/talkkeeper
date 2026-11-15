import { invoke } from "./api";
export function MicrophoneSettingsButton({ onError }: { onError: (error: unknown) => void }) {
  return <button onClick={() => void invoke("open_microphone_settings").catch(onError)}>Open microphone settings</button>;
}
export function CaptureFeedback({ systemAudio, warning, onError }: { systemAudio: boolean; warning: string | null; onError: (error: unknown) => void }) {
  return <>
    {!systemAudio && <p>This build records your microphone only. Other people are picked up only if your microphone can hear them.</p>}
    {warning === "mic_silent" && <div role="alert">No sound from your microphone. Check that the right microphone is selected in your system sound settings and that TalkKeeper is allowed to use it. <MicrophoneSettingsButton onError={onError} /></div>}
    {warning === "audio_dropped" && <div role="alert">Transcription is falling behind. Some older audio was skipped; recording is continuing.</div>}
  </>;
}
