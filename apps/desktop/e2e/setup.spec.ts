import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(import.meta.url)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test.beforeEach(async ({ page }) => {
  await page.route("**/", async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") }); });
  await page.route("**/?*", async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") }); });
});
test("consent, sizes, progress, ready, and first note", async ({ page }) => {
  await page.goto("/?setup&hold");
  await expect(page.getByText(/6.8 GB/)).toBeVisible();
  await page.getByRole("button", { name: "Set up automatically" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "50");
  await page.evaluate(() => (window as unknown as {finishSetup: () => void}).finishSetup());
  await expect(page.getByRole("heading", { name: "You're ready" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeVisible();
});
test("failed download can be retried", async ({ page }) => {
  await page.goto("/?setup&failure");
  await page.getByRole("button", { name: "Set up automatically" }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await page.getByRole("button", { name: "Retry setup" }).click();
  await expect(page.getByRole("heading", { name: "You're ready" })).toBeVisible();
});
test("own provider opens advanced settings", async ({ page }) => {
  await page.goto("/?setup");
  await page.getByRole("button", { name: "Use my own AI provider instead" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("AI provider (Advanced)")).toHaveValue("Ollama");
});
