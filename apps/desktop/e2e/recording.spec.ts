import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(
  import.meta.url,
)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("record bar counts time, stops, and scopes controls across notes", async ({
  page,
}) => {
  await page.route("**/?recording", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts"),
    });
  });
  await page.goto("/?recording");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Note title").fill("Planning");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const bar = page.getByRole("region", { name: "Recording controls" });
  await expect(
    bar.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(bar.locator(".record-timer")).toHaveText("0:01", {
    timeout: 4000,
  });
  await expect(bar.getByText("Microphone", { exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    bar.getByRole("button", { name: "Record more", exact: true }),
  ).toBeEnabled();
  await expect(bar.locator(".record-timer")).toHaveCount(0);
  await bar.getByRole("button", { name: "Record more", exact: true }).click();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const elsewhere = page.getByLabel("Recording in another note");
  await expect(elsewhere).toContainText("Recording in Planning");
  await expect(
    bar.getByRole("button", { name: "Record", exact: true }),
  ).toBeDisabled();
  await expect(
    bar.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
  await elsewhere.getByRole("button", { name: "Stop", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(elsewhere).toHaveCount(0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /^Planning/ }).click();
  await expect(
    bar.getByRole("button", { name: "Record more", exact: true }),
  ).toBeEnabled();
});

test("meeting microphone choice persists when reopening a note", async ({
  page,
}) => {
  await page.route("**/?recording", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts"),
    });
  });
  await page.goto("/?recording");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Note title").fill("Microphone meeting");
  await page.getByLabel("Meeting microphone").selectOption("USB microphone");
  await expect(page.getByLabel("Meeting microphone")).toHaveValue(
    "USB microphone",
  );
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.getByLabel("Meeting microphone")).toHaveValue(
    "USB microphone",
  );
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
});
