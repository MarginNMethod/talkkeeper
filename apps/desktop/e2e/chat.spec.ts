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
  await page.getByRole("tab", {name:"Summary", exact:true}).click();
  await page
    .getByRole("button", { name: "Write up my notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Write up my notes", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Edit written-up notes" }),
  ).toHaveValue(/Proceed with the garden plan/);
  await page.getByRole("tab", {name:"Transcript", exact:true}).click();
  await page
    .getByRole("button", { name: "Copy transcript", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Copied 7 words" }),
  ).toBeVisible();
  await page.getByRole("tab", {name:"Summary", exact:true}).click();
  await page.getByRole("button", {name:"Ask about this note"}).click();
  const chat = page.getByRole("region", { name: "Chat with this note" });
  await chat
    .getByLabel("Message", { exact: true })
    .fill("make the notes shorter");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    chat.getByRole("heading", { name: "Suggested changes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Edit written-up notes" }),
  ).toHaveValue(/Proceed with the garden plan/);
  await chat.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Edit written-up notes" }),
  ).toHaveValue("Garden plan [#12]");
  await chat.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Edit written-up notes" }),
  ).toHaveValue(/Proceed with the garden plan/);
});
