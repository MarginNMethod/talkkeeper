import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(
  import.meta.url,
)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("attendees become people with history and can start a new note", async ({
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
  await page.getByLabel("Note title").fill("Planning together");
  await page
    .getByLabel("Attendees", { exact: true })
    .fill("Ada <ada@example.org>");
  await page.getByRole("button", { name: "People", exact: true }).click();
  await page.getByRole("button", { name: "Ada (1)", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Planning together ·/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start a note with this person" })
    .click();
  await expect(page.getByLabel("Note title")).toHaveValue(
    "Untitled conversation",
  );
  await expect(page.getByLabel("Attendees", { exact: true })).toHaveValue(
    "Ada <ada@example.org>",
  );
});
