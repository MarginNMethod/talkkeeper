import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(
  import.meta.url,
)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("configure voice typing and receive history and permission guidance", async ({
  page,
}) => {
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts"),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Keyboard shortcut").fill("CommandOrControl+Shift+D");
  await page.getByLabel("Tidy up what I say").selectOption("Clean");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try voice typing" }).click();
  await expect(
    page.getByText("Plant herbs tomorrow.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Automatic paste unavailable" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check it can work" }).click();
  await expect(page.getByLabel("Voice typing permissions")).toContainText(
    "Enable Accessibility",
  );
});
