export type Theme = "light" | "dark" | "system";
let theme: Theme = "system";
try {
  const saved = localStorage.getItem("tk-theme");
  if (saved === "light" || saved === "dark") theme = saved;
} catch { /* Storage may be unavailable in a restricted webview. */ }
function apply() {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
export function getTheme(): Theme { return theme; }
export function setTheme(next: Theme): void {
  theme = next;
  apply();
  try {
    if (next === "system") localStorage.removeItem("tk-theme");
    else localStorage.setItem("tk-theme", next);
  } catch { /* Keep the in-memory choice when storage is unavailable. */ }
}
apply();
