import { CopyDiagnostics } from "./CopyDiagnostics";
import { invoke } from "./api";
export function MicrophoneSettingsButton({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  return (
    <button
      onClick={() => void invoke("open_microphone_settings").catch(onError)}
    >
      Open microphone settings
    </button>
  );
}
export function describeRecordingError(
  error: string,
  ended = false,
  timer = "0:00",
  platform = navigator.platform,
  size?: string,
) {
  const text = error.toLowerCase();
  if (ended) {
    if (/disconnect|unplug|microphone stopped|audio device stopped/.test(text))
      return {
        title: `The microphone was disconnected at ${timer}`,
        body: "Everything up to that point is saved. Reconnect it and press Record more.",
        action: "Record more",
      };
    return {
      title: `Recording stopped at ${timer}`,
      body: text.includes("overflow")
        ? "This computer couldn't keep up with speech-to-text. Everything up to that point is saved. Closing other apps or choosing a lighter speech setting will help."
        : "Something went wrong and the recording ended early. Everything up to that point is saved in the transcript.",
      action: "Record more",
    };
  }
  if (
    /permission|denied|not authorized|authorization|can't use the microphone/.test(
      text,
    )
  ) {
    if (/mac/i.test(platform))
      return {
        title: "TalkKeeper isn't allowed to use the microphone",
        body: "Turn on TalkKeeper under System Settings › Privacy & Security › Microphone, then come back and press Record.",
        action: "Open microphone settings",
      };
    if (/win/i.test(platform))
      return {
        title: "TalkKeeper isn't allowed to use the microphone",
        body: "Turn on microphone access for desktop apps under Settings › Privacy & security › Microphone, then press Record.",
        action: "Open microphone settings",
      };
    return {
      title: "TalkKeeper can't reach the microphone",
      body: "Check that a microphone is connected and that no other app has locked it, then press Record.",
      action: "Try again",
    };
  }
  if (
    /no.*(input|device|microphone)|(microphone|input device).*not found/.test(
      text,
    )
  )
    return {
      title: "No microphone found",
      body: "Plug in or switch on a microphone, then press Record.",
      action: "Try again",
    };
  if (
    /download the selected|choose an stt|unknown local model|model verification/.test(
      text,
    )
  )
    return {
      title: "Speech-to-text isn't installed yet",
      body: `TalkKeeper needs a one-time download${size ? ` (${size})` : ""} before it can turn speech into text. Nothing leaves this computer.`,
      action: "Download now",
    };
  if (/set the transcription/.test(text))
    return {
      title: "Your transcription service isn't set up",
      body: "Add its address and key in Settings, or switch back to transcribing on this computer.",
      action: "Open Settings",
    };
  if (
    /provider|http request|stt events|session closed|invalid audio|speech recognition/.test(
      text,
    )
  )
    return {
      title: "Speech-to-text couldn't start",
      body: "Try again. If it keeps happening, restart TalkKeeper.",
      action: "Try again",
    };
  return {
    title: "Something went wrong",
    body: "TalkKeeper could not finish that. Your notes are safe. Try again; if it keeps happening, restart TalkKeeper.",
    action: "Try again",
  };
}
export function CaptureFeedback({
  lag = 0,
  systemAudio,
  warning,
  onError,
  onMicrophone,
  onRestart,
  onStop,
  onDismiss,
}: {
  lag?: number;
  systemAudio: boolean;
  warning: string | null;
  onError: (error: unknown) => void;
  onMicrophone?: () => void;
  onRestart?: () => void;
  onStop?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <>
      {!systemAudio && (
        <p className="record-mic-only">
          This build records your microphone only. Other people are picked up
          only if your microphone can hear them.
        </p>
      )}
      {warning && (
        <div role={warning === "long_silence" ? "status" : "alert"} className="record-warning">
          <CopyDiagnostics />
          {warning === "mic_silent" && (
            <>
              <strong>We can't hear anything</strong>
              <p>
                Your microphone seems to be silent. Check that it isn't muted
                and that the right one is selected.
              </p>
              <button
                onClick={
                  onMicrophone ??
                  (() => void invoke("open_microphone_settings").catch(onError))
                }
              >
                Choose microphone
              </button>
              <button onClick={onDismiss}>Dismiss</button>
            </>
          )}
          {warning === "no_words" && (
            <>
              <strong>We can hear you, but no words are appearing</strong>
              <p>
                Speech-to-text may be stuck. The sound is still being kept. You
                can wait, or stop and start again.
              </p>
              <button onClick={onRestart}>Stop and start again</button>
              <button onClick={onDismiss}>Keep waiting</button>
            </>
          )}
          {warning === "behind" && (
            <>
              <strong>The transcript is running behind</strong>
              <p>
                Words are appearing about {lag} seconds late because this
                computer is busy. Nothing is lost; it will catch up.
              </p>
              <button onClick={onDismiss}>Dismiss</button>
            </>
          )}
          {warning === "audio_dropped" && (
            <>
              <strong>The transcript is running behind</strong>
              <p>
                Some older audio was skipped; recording is continuing. Closing
                other apps or choosing a lighter speech setting will help.
              </p>
              <button onClick={onDismiss}>Dismiss</button>
            </>
          )}
          {warning === "long_silence" && (
            <>
              <strong>It's been quiet for 5 minutes</strong>
              <p>Has the meeting ended?</p>
              <button onClick={onStop}>Stop recording</button>
              <button onClick={onDismiss}>Keep recording</button>
            </>
          )}
        </div>
      )}
    </>
  );
}
