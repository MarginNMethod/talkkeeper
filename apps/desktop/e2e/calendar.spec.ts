import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(
  import.meta.url,
)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("add a private calendar and start linked notes", async ({ page }) => {
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts"),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Private calendar link")
    .fill("https://example.test/private-calendar");
  await page.getByRole("button", { name: "Add calendar", exact: true }).click();
  await expect(page.getByLabel("Private calendar link")).toHaveValue("");
  await expect(page.getByText("Calendar saved on this computer")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Today & upcoming", exact: true })
    .click();
  await expect(
    page.getByText("Calendar planning", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start notes", exact: true }).click();
  await expect(page.locator("input.title")).toHaveValue("Calendar planning");
  await expect(page.getByLabel("Linked calendar event")).toContainText(
    "Calendar planning",
  );
  await expect(page.getByRole("combobox", { name: "Attendees" })).toHaveValue(
    "Alex <alex@example.test>",
  );
});
