const paths: Record<string, string> = {
  Notes: "M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6",
  Today: "M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16",
  "Ask your notes": "M4 4h16v12H9l-5 4z M8 8h8 M8 12h5",
  People: "M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  Companies: "M5 21V3h14v18 M9 7h1 M14 7h1 M9 11h1 M14 11h1 M10 21v-5h4v5",
  Trash: "M4 6h16 M9 3h6l1 3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  Settings:
    "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  Folder: "M3 6h7l2 3h9v11H3z",
};
export function SidebarIcon({ name }: { name: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.Notes} />
    </svg>
  );
}
