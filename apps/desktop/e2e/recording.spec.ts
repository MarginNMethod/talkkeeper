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
  await bar.getByRole("button", {name:"Recording options"}).click();
  await expect(bar.getByLabel("Meeting microphone")).toBeVisible();
  await page.keyboard.press("Escape");
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
  await bar.getByRole("button", {name:"Recording options"}).click();
  await expect(bar.getByRole("button", {name:"Take pictures of my screen"})).toBeDisabled();
  await page.keyboard.press("Escape");
  const stopElsewhere = elsewhere.getByRole("button", { name: "Stop", exact: true });
  await stopElsewhere.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(stopElsewhere).toBeFocused();
  await stopElsewhere.click();
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
  await page.getByRole("button", {name:"Recording options"}).click();
  await page.getByLabel("Meeting microphone").selectOption("USB microphone");
  await expect(page.getByLabel("Meeting microphone")).toHaveValue(
    "USB microphone",
  );
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("button", {name:"Recording options"}).click();
  await expect(page.getByLabel("Meeting microphone")).toHaveValue(
    "USB microphone",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
});

test("cancel during startup returns to Record and diagnostics is in Settings", async ({ page }) => {
  await page.route("**/?recording&starting", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") });
  });
  await page.goto("/?recording&starting");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
});

test("quiet note views, chat, warning recovery and More actions", async ({ page }) => {
  await page.route("**/?recording", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") });
  });
  await page.goto("/?recording");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveText(["Notes", "Transcript", "Summary"]);
  await page.getByRole("tab", { name: "Transcript", exact: true }).click();
  await expect(page.getByText("Your transcript will appear here when you record.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await expect(page.getByRole("button", { name: "Write up my notes", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Ask about this note", exact: true }).click();
  await expect(page.getByRole("region", { name: "Chat with this note" })).toBeVisible();
  const bar = page.getByRole("region", { name: "Recording controls" });
  await expect(bar.getByRole("alert")).toHaveCount(0);
  await bar.getByRole("button", { name: "Record", exact: true }).click();
  await bar.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await expect(bar.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await bar.getByRole("button", { name: "Resume", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("mock:capture-warning")));
  await expect(bar.getByRole("alert")).toHaveCount(1);
  await expect(bar.getByRole("button", { name: "Copy diagnostics", exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(bar.getByRole("alert")).toHaveCount(0);
  await bar.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(bar.locator(".record-level")).toHaveCount(0);
  await page.getByRole("button", { name: "More actions for this note" }).click();
  await expect(page.getByRole("button", { name: "Export transcript", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Untitled meeting", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: "Untitled meeting", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore note", exact: true })).toBeVisible();
});
