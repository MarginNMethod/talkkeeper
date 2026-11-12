import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(
  import.meta.url,
)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("meeting snapshots require consent, show count and gallery, delete and keep unsupported images local", async ({
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
  await page
    .getByRole("button", { name: "Start capture", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Capture shared screen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start snapshots", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I understand and agree to capture this source")
    .check();
  await expect(page.getByRole("option", { name: "Slides window" })).toHaveCount(
    1,
  );
  await page
    .getByLabel("Screen source", { exact: true })
    .selectOption("window:2");
  await page
    .getByRole("button", { name: "Start snapshots", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Screen snapshots on · 1 snapshots" }),
  ).toBeVisible();
  const gallery = page.getByRole("region", {
    name: "Screen snapshots",
    exact: true,
  });
  await expect(gallery.getByRole("img")).toHaveCount(1);
  await expect(gallery).toContainText(
    "Your current AI model can't read images; snapshots are saved but not used.",
  );
  await gallery.getByLabel("Don't use this in the summary").check();
  await expect(
    gallery.getByLabel("Don't use this in the summary"),
  ).toBeChecked();
  await gallery
    .getByRole("button", { name: "Delete snapshot at 0:10", exact: true })
    .click();
  await expect(gallery).toHaveCount(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Screen snapshots on · 0 snapshots" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop snapshots", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Capture shared screen", exact: true }),
  ).toBeVisible();
});
