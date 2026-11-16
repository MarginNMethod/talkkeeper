import { Modal } from "./Modal";

export function RecordingConsent({ onStart, onCancel, onCopy }: {
  onStart: () => void;
  onCancel: () => void;
  onCopy: () => void;
}) {
  return (
    <Modal onClose={onCancel} aria-label="Before you record">
      <h2>Before you record</h2>
      <p>Make sure everyone in the conversation knows it is being recorded and agrees. In many places this is required by law.</p>
      <button className="primary" autoFocus onClick={onStart}>Start recording</button>
      <button onClick={onCancel}>Not yet</button>
      <button onClick={onCopy}>Copy a message to send them</button>
    </Modal>
  );
}
