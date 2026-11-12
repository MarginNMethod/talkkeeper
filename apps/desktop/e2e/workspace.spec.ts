import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(
  import.meta.url,
)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("create, write, enhance, search and export a note", async ({ page }) => {
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts"),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note title" })
    .fill("Garden conversation");
  await page
    .getByRole("textbox", { name: "Rough notes" })
    .fill("Discuss the garden plan");
  await page.getByRole("button", { name: "Enhance", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Edit summary" })).toHaveValue(
    /Proceed with the garden plan/,
  );
  await page
    .getByRole("textbox", { name: "Search notes", exact: true })
    .fill("garden");
  await expect(
    page.getByRole("button", { name: /Garden conversation/ }),
  ).toBeVisible();
  await page.getByText("Export", { exact: true }).click();
  await page
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { exported: string }).exported),
    )
    .toContain("garden plan");
});
