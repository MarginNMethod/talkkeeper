import { useEffect, useRef } from "react";

export function RecordingConsent({ onStart, onCancel, onCopy }: {
  onStart: () => void;
  onCancel: () => void;
  onCopy: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} className="record-consent" aria-label="Before you record"
      onCancel={event => { event.preventDefault(); onCancel(); }}>
      <h2>Before you record</h2>
      <p>Make sure everyone in the conversation knows it is being recorded and agrees. In many places this is required by law.</p>
      <button autoFocus onClick={onStart}>Start recording</button>
      <button onClick={onCancel}>Not yet</button>
      <button onClick={onCopy}>Copy a message to send them</button>
    </dialog>
  );
}
