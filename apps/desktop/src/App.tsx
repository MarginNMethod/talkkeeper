import { WelcomeCard } from '@talkkeeper/ui';

export function App() {
  return <main><WelcomeCard title="TalkKeeper"><p>A private place for conversations and the ideas they spark.</p><p>Capture, transcription, and summaries are coming in Phase 1.</p><aside><h2>Recording consent</h2><p>Many jurisdictions require consent from all parties. You are responsible for notifying participants before recording. A notify-participants helper is planned.</p></aside></WelcomeCard></main>;
}
