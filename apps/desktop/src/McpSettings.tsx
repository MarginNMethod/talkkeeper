import { useEffect, useState } from "react";
import { data, invoke } from "./api";
interface McpStatus {
  preferences: { enabled: boolean; include_transcripts: boolean; include_calendar: boolean };
  executable: string | null;
  database: string;
}
interface Access { timestamp: string; tool: string }
const call = <T,>(action: string, payload: unknown = {}) => invoke<T>("mcp_data", { action, payload });
export function McpSettings({ onError }: { onError: (e: unknown) => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [access, setAccess] = useState<Access[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let mounted = true;
    void Promise.all([call<McpStatus>("status"), call<Access[]>("recent")])
      .then(([s, a]) => { if (mounted) { setStatus(s); setAccess(a); } }).catch(onError);
    return () => { mounted = false; };
  }, [onError]);
  async function toggle(key: keyof McpStatus["preferences"], value: boolean) {
    setSaving(true);
    try {
      await call("set", { key, value });
      setStatus((s) => s && ({ ...s, preferences: { ...s.preferences, [key]: value } }));
    } catch (e) { onError(e); } finally { setSaving(false); }
  }
  if (!status) return <section aria-label="Connect other AI tools"><h3>Connect other AI tools</h3><p>Loading connection settings…</p></section>;
  const command = status.executable ?? "<PATH TO talkkeeper-mcp EXECUTABLE>";
  const config = JSON.stringify({ mcpServers: { talkkeeper: { command, args: ["--db", status.database] } } }, null, 2);
  // Single quotes preserve paths in POSIX shells and PowerShell; embedded quotes are escaped per shell.
  const posix = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const powershell = (s: string) => "'" + s.replaceAll("'", "''") + "'";
  const windows = /[A-Za-z]:\\/.test(command);
  const quote = windows ? powershell : posix;
  const cli = `claude mcp add --transport stdio talkkeeper -- ${quote(command)} --db ${quote(status.database)}`;
  async function copy(label: string, text: string) {
    try { await data("copy_text", { text }); setMessage(`${label} copied`); } catch (e) { onError(e); }
  }
  return <section aria-label="Connect other AI tools">
    <h3>Connect other AI tools</h3>
    <p>Other AI tools on this computer can read your notes while you use them. Anything they read may be sent to that tool&apos;s AI provider.</p>
    <p role="note"><strong>Privacy warning: a cloud assistant may send anything it reads to its provider. Enable access only for tools you trust.</strong> TalkKeeper cannot identify which provider another tool uses.</p>
    {([
      ["enabled", "Allow other AI tools to read notes"],
      ["include_transcripts", "Include transcripts"],
      ["include_calendar", "Include calendar meetings"],
    ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={status.preferences[key]} disabled={saving} onChange={(e) => void toggle(key, e.target.checked)} />{label}</label>)}
    <p>Changes apply immediately. Trashed notes, images, dictation history and credentials are excluded.</p>
    <details><summary>How to connect</summary>
      <p>Download the MCP executable for your system from the release, place it beside TalkKeeper or on PATH, then reopen Settings. Each client launches this executable itself over stdio.</p>
      {!status.executable && <p role="alert">Executable not found. Replace the clearly marked placeholder below with the full installed path.</p>}
      <h4>Claude Desktop</h4><pre aria-label="Claude Desktop configuration">{config}</pre><button onClick={() => void copy("Claude Desktop configuration", config)}>Copy Claude Desktop configuration</button>
      <h4>Claude Code ({windows ? "PowerShell" : "shell"})</h4><pre aria-label="Claude Code command">{cli}</pre><button onClick={() => void copy("Claude Code command", cli)}>Copy Claude Code command</button>
      <h4>Cursor and other stdio clients</h4><pre aria-label="Generic stdio configuration">{config}</pre><button onClick={() => void copy("Generic stdio configuration", config)}>Copy generic configuration</button>
      <p>See docs/mcp.md for configuration file locations and troubleshooting.</p>
      <button onClick={() => void call<string>("check").then(setMessage).catch(onError)}>Test MCP connection</button>
      <p>The test uses the same database and settings check as talkkeeper-mcp --check. Client configuration and executable permissions must also be correct.</p>
    </details>
    <p role="status">{message}</p>
    <h4>Recent access</h4>
    <button onClick={() => void call<Access[]>("recent").then(setAccess).catch(onError)}>Refresh recent access</button>
    <button onClick={() => void call("clear").then(() => setAccess([])).catch(onError)}>Clear recent access</button>
    {access.length ? <ul>{access.map((a, i) => <li key={`${a.timestamp}-${i}`}><time>{a.timestamp}</time> — {a.tool}</li>)}</ul> : <p>No recent access</p>}
  </section>;
}
