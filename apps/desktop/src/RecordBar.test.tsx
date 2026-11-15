import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  RecordBar,
  RecordingElsewhere,
  levelBars,
  recordingTime,
  type RecordBarProps,
} from "./RecordBar";
import { describeRecordingError } from "./CaptureFeedback";
import { data, invoke } from "./api";
vi.mock("./api", () => ({
  data: vi.fn(async () => ({})),
  invoke: vi.fn(async () => []),
}));
const base: RecordBarProps = {
  state: "stopped",
  elapsed: 0,
  hasTranscript: false,
  finished: false,
  systemAudio: false,
  levels: {},
  warning: null,
  silence: false,
  error: "",
  onCommand: vi.fn(),
  onSettings: vi.fn(),
  onMicrophone: vi.fn(),
  onDismissSilence: vi.fn(),
  onRestore: vi.fn(),
  onGo: vi.fn(),
  onStopOther: vi.fn(),
  onStopDictation: vi.fn(),
  onCopyNotice: vi.fn(),
  onDownload: vi.fn(),
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
test.each([
  ["stopped", false, "Record", "start_capture"],
  ["stopped", true, "Record more", "start_capture"],
  ["recording", false, "Stop", "stop_capture"],
  ["paused", false, "Resume", "resume_capture"],
  ["starting", false, "Starting…", null],
  ["finishing", false, "Finishing…", null],
])("record state %s transcript %s", (state, hasTranscript, name, command) => {
  render(<RecordBar {...base} state={state} hasTranscript={hasTranscript} />);
  const button = screen.getByRole("button", { name }) as HTMLButtonElement;
  expect(button.disabled).toBe(!command);
  fireEvent.click(button);
  if (command) expect(base.onCommand).toHaveBeenCalledWith(command);
  expect(screen.queryByRole("button", { name: "Pause" }) !== null).toBe(
    state === "recording",
  );
});
test.each([
  [{ trashed: true }, "Restore this note to record in it.", "Restore note"],
  [
    { otherTitle: "Planning" },
    'Already recording in "Planning" (0:00).',
    "Go to that note",
  ],
  [
    { dictating: true },
    "Dictation is on. Stop it to record a meeting.",
    "Stop dictation",
  ],
])("blocked controls %j", (props, sentence, action) => {
  render(<RecordBar {...base} {...props} />);
  expect(
    (screen.getByRole("button", { name: "Record" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText(sentence)).toBeTruthy();
  expect(screen.getByRole("button", { name: action })).toBeTruthy();
});
test("elsewhere strip names the note and targets explicit actions", () => {
  render(
    <RecordingElsewhere
      title="Planning"
      elapsed={12000}
      status="recording"
      onGo={base.onGo}
      onStop={base.onStopOther}
    />,
  );
  expect(
    screen.getByLabelText("Recording in another note").textContent,
  ).toContain("Recording in Planning · 0:12");
  fireEvent.click(screen.getByText("Go to it"));
  fireEvent.click(screen.getByText("Stop"));
  expect(base.onGo).toHaveBeenCalled();
  expect(base.onStopOther).toHaveBeenCalled();
  expect(screen.queryByText("Pause")).toBeNull();
});
test.each([
  ["mic_silent", "We can't hear anything", "Choose microphone"],
  [
    "no_words",
    "We can hear you, but no words are appearing",
    "Stop and start again",
  ],
  ["audio_dropped", "The transcript is running behind", "Dismiss"],
  ["long_silence", "It's been quiet for 5 minutes", "Stop recording"],
])("warning %s has a working recovery button", (warning, title, action) => {
  render(<RecordBar {...base} state="recording" warning={warning} />);
  expect(screen.getByText(title)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: action }));
  if (warning === "mic_silent") expect(base.onMicrophone).toHaveBeenCalled();
  if (warning === "no_words")
    expect(base.onCommand).toHaveBeenCalledWith("restart");
  if (warning === "long_silence")
    expect(base.onCommand).toHaveBeenCalledWith("stop_capture");
  if (warning === "audio_dropped") expect(screen.queryByText(title)).toBeNull();
});
test("health detects silent input at eight seconds and sound without words at 45 seconds", () => {
  vi.useFakeTimers();
  const view = render(<RecordBar {...base} state="recording" elapsed={8000} />);
  expect(screen.getByText("We can't hear anything")).toBeTruthy();
  view.rerender(
    <RecordBar
      {...base}
      state="recording"
      elapsed={45000}
      levels={{ Me: -20 }}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(46000);
  });
  // Let each interval commit so cumulative speech time reflects the live clock.
  for (let i = 0; i < 81; i++)
    act(() => {
      vi.advanceTimersByTime(250);
    });
  expect(
    screen.getByText("We can hear you, but no words are appearing"),
  ).toBeTruthy();
});
test("timer formats hours and meter rejects room noise", () => {
  expect(recordingTime(3661000)).toBe("1:01:01");
  expect(levelBars(-60)).toBe(0);
  expect(levelBars(-12)).toBe(5);
  expect(levelBars(-55)).toBe(1);
});
test.each([
  ["Download the selected model first", "Speech-to-text isn't installed yet"],
  ["Choose an STT model in Settings", "Speech-to-text isn't installed yet"],
  ["Unknown local model", "Speech-to-text isn't installed yet"],
  ["model verification failed", "Speech-to-text isn't installed yet"],
  ["Set the transcription endpoint", "Your transcription service isn't set up"],
  ["Set the transcription key", "Your transcription service isn't set up"],
  ...[
    "provider failed: secret",
    "model or provider HTTP request failed",
    "STT events unavailable",
    "session closed",
    "invalid audio: bad samples",
  ].map((e) => [e, "Speech-to-text couldn't start"]),
  ["audio backend: no input device", "No microphone found"],
  ["unknown private diagnostic", "Something went wrong"],
])("maps %s", (error, title) => {
  expect(describeRecordingError(error).title).toBe(title);
  render(<RecordBar {...base} error={error} />);
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.getByText("Details")).toBeTruthy();
});
test("permission errors respect OS; unexpected stops preserve saved words", () => {
  expect(
    describeRecordingError("permission denied", false, "0:00", "MacIntel").body,
  ).toContain("System Settings");
  expect(
    describeRecordingError("permission denied", false, "0:00", "Win32").body,
  ).toContain("desktop apps");
  expect(
    describeRecordingError("permission denied", false, "0:00", "Linux").title,
  ).toBe("TalkKeeper can't reach the microphone");
  expect(
    describeRecordingError("audio frame queue overflow", true, "2:12").title,
  ).toBe("Recording stopped at 2:12");
  expect(describeRecordingError("microphone stopped", true, "2:12").title).toBe(
    "The microphone was disconnected at 2:12",
  );
});

test("actual device errors map to microphone recovery", () => {
  expect(
    describeRecordingError("audio backend: microphone not found").title,
  ).toBe("No microphone found");
  expect(
    describeRecordingError(
      "TalkKeeper can't use the microphone. Allow it in System Settings",
      false,
      "0:00",
      "MacIntel",
    ).action,
  ).toBe("Open microphone settings");
});

test("backlog warning clears below five seconds and first words confirm once", () => {
  vi.useFakeTimers();
  const view = render(
    <RecordBar {...base} state="recording" lag={20} wordsAt={Date.now()} />,
  );
  expect(screen.getByText("The transcript is running behind")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(
    screen.getByText("Recording. Words are appearing in the transcript."),
  ).toBeTruthy();
  view.rerender(
    <RecordBar
      {...base}
      state="recording"
      lag={8}
      wordsAt={Date.now() - 250}
    />,
  );
  expect(screen.getByText("The transcript is running behind")).toBeTruthy();
  view.rerender(
    <RecordBar
      {...base}
      state="recording"
      lag={4}
      wordsAt={Date.now() - 250}
    />,
  );
  expect(screen.queryByText("The transcript is running behind")).toBeNull();
  act(() => {
    vi.advanceTimersByTime(6000);
  });
  expect(screen.getByText("Recording", { exact: true })).toBeTruthy();
});

test("meter peaks fall even while quieter frames continue arriving", () => {
  vi.useFakeTimers();
  const view = render(
    <RecordBar {...base} state="recording" levels={{ Me: -12 }} />,
  );
  expect(view.container.querySelectorAll(".level-bars .lit")).toHaveLength(5);
  for (let i = 0; i < 20; i++) {
    view.rerender(
      <RecordBar {...base} state="recording" levels={{ Me: -60 - i }} />,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
  }
  expect(view.container.querySelectorAll(".level-bars .lit")).toHaveLength(0);
});

test("missing saved microphone uses system default and explains the fallback", async () => {
  vi.mocked(data).mockResolvedValueOnce({meeting_microphone:"Old headset"});
  vi.mocked(invoke).mockResolvedValueOnce(["USB microphone"]);
  render(<RecordBar {...base} />);
  await screen.findByText("Your saved microphone is unavailable. Using the system default microphone.");
  expect((screen.getByLabelText("Meeting microphone") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Meeting microphone"), {target:{value:"USB microphone"}});
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("recording_preferences", {microphone:"USB microphone"}));
  await waitFor(() => expect((screen.getByLabelText("Meeting microphone") as HTMLSelectElement).value).toBe("USB microphone"));
});
test("consent reminder disappears when a take stops", () => {
  const view = render(<RecordBar {...base} />);
  expect(screen.getByText(/Tell everyone before you record/)).toBeTruthy();
  view.rerender(<RecordBar {...base} finished />);
  expect(screen.queryByText(/Tell everyone before you record/)).toBeNull();
});
