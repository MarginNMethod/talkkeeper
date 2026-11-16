import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
const css = readFileSync("src/style.css", "utf8");
function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map(c => parseInt(c, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
test("both themes meet AA for text on their intended surfaces", () => {
  const themes = [css.match(/:root \{([\s\S]*?)\n\}/)![1], css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)![1]];
  for (const theme of themes) {
    const tokens = Object.fromEntries([...theme.matchAll(/--([\w-]+): (#[a-f\d]{6});/g)].map(m => [m[1], m[2]]));
    const pairs = ["text", "muted", "text-tertiary", "accent"].flatMap(text => ["surface", "panel", "surface-sunken"].map(bg => [text, bg]));
    pairs.push(["on-accent", "accent"], ["danger", "danger-tint"], ["warn-text", "warn-tint"]);
    for (const [text, bg] of pairs) {
      const a = luminance(tokens[text]), b = luminance(tokens[bg]);
      expect((Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05), `${text} on ${bg}: ${tokens[text]} / ${tokens[bg]}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
