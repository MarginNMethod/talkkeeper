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

test("selected notes answer with a citation; recipe result saves as a note", async ({
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
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Note title", { exact: true }).fill("Garden planning");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Note title", { exact: true }).fill("Garden follow-up");
  await page.getByLabel("Select note Garden planning", { exact: true }).check();
  await page
    .getByLabel("Select note Garden follow-up", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Ask your notes", exact: true })
    .click();
  await page
    .getByLabel("Choose scope", { exact: true })
    .selectOption("selected");
  await expect(page.getByLabel("Scope chips")).toContainText(
    "2 notes included",
  );
  await page
    .getByLabel("Question", { exact: true })
    .fill("What was approved for the garden?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByText("Searched 2 notes / 2 segments and sections; retrieved 2."),
  ).toBeVisible();
  await page.getByRole("link", { name: "[Garden planning · 1:30]" }).click();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Garden planning",
  );
  await expect(page.locator("#segment-1")).toContainText("garden approved");
  await page
    .getByRole("button", { name: "Ask your notes", exact: true })
    .click();
  await page.getByLabel("Recipe", { exact: true }).selectOption("recipe-1");
  await page.getByRole("button", { name: "Run recipe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save as note", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save as note", exact: true }).click();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Recipe result",
  );
  await expect(
    page.getByRole("textbox", { name: "Rough notes", exact: true }),
  ).toContainText("Garden approved");
});
