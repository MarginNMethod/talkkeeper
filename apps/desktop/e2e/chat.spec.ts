import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(
  import.meta.url,
)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("copy transcript, propose a shorter note, apply and undo", async ({
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
  await page.getByRole("button", { name: "Enhance", exact: true }).click();
  // Wait for the summary to be fully written, not just started.
  await expect(
    page.getByRole("button", { name: "Use Redo notes below" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Edit summary" })).toHaveValue(
    /Proceed with the garden plan/,
  );
  await page
    .getByRole("button", { name: "Copy transcript", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Copied 7 words" }),
  ).toBeVisible();
  const chat = page.getByRole("region", { name: "Chat with this note" });
  await chat
    .getByLabel("Message", { exact: true })
    .fill("make the notes shorter");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    chat.getByRole("heading", { name: "Proposed revision" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Edit summary" })).toHaveValue(
    /Proceed with the garden plan/,
  );
  await chat.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Edit summary" })).toHaveValue(
    "Garden plan [#12]",
  );
  await chat.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Edit summary" })).toHaveValue(
    /Proceed with the garden plan/,
  );
});
