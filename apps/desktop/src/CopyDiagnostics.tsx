import { useState } from "react";
import { data, invoke } from "./api";

export function CopyDiagnostics() {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      const report = await invoke<string>("diagnostics_report");
      await data("copy_text", { text: report });
      setStatus("Copied");
    } catch {
      setStatus("Couldn't copy diagnostics. Try again.");
    }
  }
  return <><button onClick={() => void copy()}>Copy diagnostics</button>{status && <span role="status">{status}</span>}</>;
}
