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
  await page.getByLabel("Dictation hotkey").fill("CommandOrControl+Shift+D");
  await page.getByLabel("Dictation style").selectOption("Clean");
  await page.getByRole("button", { name: "Save dictation settings" }).click();
  await expect(
    page.getByText("Dictation settings saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try dictation" }).click();
  await expect(
    page.getByText("Plant herbs tomorrow.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Automatic paste unavailable" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check permissions" }).click();
  await expect(page.getByLabel("Dictation permissions")).toContainText(
    "Enable Accessibility",
  );
});
