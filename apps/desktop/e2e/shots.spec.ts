import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const { expect, test }: typeof import("@playwright/test") = createRequire(import.meta.url)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");

// Register only on explicit request; ordinary browser runs do not collect shots.
if (process.env.SHOTS === "1") {
  for (const theme of ["light", "dark"] as const) {
    test(`main views in ${theme}`, async ({ page }) => {
      await mkdir("e2e/screenshots", { recursive: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      // Opposite OS preference verifies that the explicit choice wins.
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light", reducedMotion: "reduce" });
      await page.addInitScript((choice) => localStorage.setItem("tk-theme", choice), theme);
      await page.route(/\/($|\?)/, async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") });
      });
      const shot = async (name: string) => {
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.screenshot({ path: `e2e/screenshots/${theme}-${name}.png`, fullPage: true });
      };
      await page.goto("/?shell");
      await expect(page.getByRole("button", { name: "New note", exact: true })).toBeVisible();
      await shot("home");
      await page.getByRole("button", {name:"Product conversations",exact:true}).click();
      await expect(page.getByRole("heading", {name:"Product conversations",exact:true})).toBeVisible();
      await shot("space");
      for (const name of ["Today", "People", "Companies"]) {
        const nav = page.getByRole("button", { name, exact: true });
        // People and Companies only appear once the mock data has some.
        if (name !== "Today" && (await nav.count()) === 0) continue;
        await nav.click();
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
        await shot(name.toLowerCase());
      }
      await page.getByRole("button", { name: "New note", exact: true }).click();
      await page.getByLabel("Note title", { exact: true }).fill("A little room to think");
      await page.getByRole("textbox", { name: "Your notes", exact: true }).fill("A calm space for the next conversation.");
      await shot("note");
      await page.getByText("Ask about this note", { exact: true }).click();
      await expect(page.getByRole("region", { name: "Chat with this note" })).toBeVisible();
      await shot("note-chat");
      await page.getByRole("button", { name: "Ask your notes", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Ask your notes", exact: true })).toBeVisible();
      await shot("workspace-chat");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
      await shot("settings");
      await page.goto("/?setup");
      await expect(page.getByRole("button", { name: "Get started", exact: true })).toBeVisible();
      await shot("first-run");
    });
  }
}

// Exercise native keyboard activation in a real browser, using the mock app host.
test('shared popover supports Enter, Tab, Escape and Space', async ({ page }) => {
  await page.route("**/", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the TSX fixture directly.
    await import('/e2e/primitives-harness.tsx');
  });
  const trigger = page.getByRole('button', { name: 'Primitive options' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Rename item' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Primitive options' })).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: 'Primitive options' })).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
