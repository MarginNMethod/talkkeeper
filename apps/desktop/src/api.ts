import { invoke } from "@tauri-apps/api/core";
export const data = <T>(action: string, payload: unknown = {}) =>
  invoke<T>("data", { action, payload });
export interface Note {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  notes_doc: unknown;
  notes_markdown: string;
  summary_markdown: string | null;
  template_id: string | null;
  folder_id: string | null;
  attendees: { name: string; email: string }[];
  deleted_at: string | null;
}
export interface Segment {
  id: string;
  note_id: string;
  seq: number;
  start_ms: number;
  speaker: string | { Named: string };
  text: string;
}
export interface Template {
  id: string;
  name: string;
  description: string;
  sections: { heading: string; guidance: string }[];
  extra_instructions: string;
  built_in: boolean;
}
export interface Preferences {
  provider?: string;
  base_url?: string;
  model?: string;
  stt_engine?: string;
  stt_model?: string;
  stt_url?: string;
  language?: string;
  vocabulary?: string[];
  retention?: number;
  notice?: string;
}
export { invoke };
