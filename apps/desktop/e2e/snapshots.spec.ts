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
  await page.getByRole("button", { name: "Record more", exact: true }).click();
  await page.getByRole("button", {name:"Recording options"}).click();
  await page
    .getByRole("button", { name: "Take pictures of my screen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start taking pictures", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I understand and agree to take pictures of this source")
    .check();
  await expect(page.getByRole("option", { name: "Slides window" })).toHaveCount(
    1,
  );
  await page
    .getByLabel("Screen source", { exact: true })
    .selectOption("window:2");
  await page
    .getByRole("button", { name: "Start taking pictures", exact: true })
    .click();
  await page.getByRole("button", {name:"Recording options"}).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Taking screen pictures · 1" }),
  ).toBeVisible();
  await page.getByRole("tab", {name:"Transcript", exact:true}).click();
  const gallery = page.getByRole("region", {
    name: "Screen pictures",
    exact: true,
  });
  await expect(gallery.getByRole("img")).toHaveCount(1);
  await expect(gallery).toContainText(
    "Your current AI model can't read images; pictures are saved but not used.",
  );
  await gallery.getByLabel("Don't use this in the summary").check();
  await expect(
    gallery.getByLabel("Don't use this in the summary"),
  ).toBeChecked();
  await gallery
    .getByRole("button", { name: "Delete picture at 0:10", exact: true })
    .click();
  await expect(gallery).toHaveCount(0);
  await page.getByRole("button", {name:"Recording options"}).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Taking screen pictures · 0" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Take pictures of my screen",
      exact: true,
    }),
  ).toBeVisible();
});
