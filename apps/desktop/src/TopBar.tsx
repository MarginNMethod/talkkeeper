import { Button, IconButton } from "@talkkeeper/ui";

export function TopBar({ collapsed, onToggle, onSearch, onCreate }: {
  collapsed: boolean;
  onToggle: () => void;
  onSearch: () => void;
  onCreate: () => void;
}) {
  return <div className="top-bar">
    <IconButton aria-label="Toggle sidebar" aria-expanded={!collapsed} onClick={onToggle}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 5h16v14H4z M10 5v14" /></svg>
    </IconButton>
    <IconButton aria-label="Search notes" onClick={onSearch}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
    </IconButton>
    <Button onClick={onCreate}>New note</Button>
  </div>;
}
