import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(import.meta.url)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test.beforeEach(async ({ page }) => {
  await page.route("**/", async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") }); });
  await page.route("**/?*", async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") }); });
});
test("one click opens a note; speech and AI unlock independently and Settings preserves progress", async ({ page }) => {
  await page.goto("/?setup&hold");
  await expect(page.getByText(/Downloads 6.8 GB/)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Untitled meeting");
  await expect(page.getByRole("textbox", {name:"Rough notes"})).toBeFocused();
  await expect(page.getByRole("button",{name:"New note",exact:true})).toBeEnabled();
  await expect(page.getByRole("button",{name:"Record",exact:true})).toBeDisabled();
  await page.evaluate(() => (window as unknown as { readySpeech: () => void }).readySpeech());
  await expect(page.getByRole("button",{name:"Record",exact:true})).toBeEnabled();
  await expect(page.getByRole("button",{name:"Write up my notes",exact:true})).toBeDisabled();
  const card=page.getByRole("region",{name:"Setup status"});
  await expect(card.getByText(/1.4 of 6.8 GB/)).toBeVisible();
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await expect(card.getByText(/1.4 of 6.8 GB/)).toBeVisible();
  await page.getByRole("button",{name:"Close",exact:true}).click();
  await expect(card.getByText(/1.4 of 6.8 GB/)).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishSetup: () => void }).finishSetup());
  await expect(page.getByRole("button",{name:"Write up my notes",exact:true})).toBeEnabled();
});
test("network wait and pause are recoverable in the persistent card",async({page})=>{
  await page.goto("/?setup&hold");await page.getByRole("button",{name:"Get started"}).click();
  await page.evaluate(()=>(window as unknown as {offlineSetup:()=>void}).offlineSetup());
  await expect(page.getByText("Waiting for the internet. Your download is saved and will carry on by itself.")).toBeVisible();
  await page.getByRole("region",{name:"Setup status"}).getByRole("button",{name:"Pause",exact:true}).click();await expect(page.getByText(/Download paused/)).toBeVisible();
});
test("own provider opens a small panel and Back changes nothing", async ({ page }) => {
  await page.goto("/?setup");await page.getByRole("link",{name:"I already have my own AI provider"}).click();
  await expect(page.getByRole("heading",{name:"Use your own AI provider"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Save and continue"})).toBeDisabled();
  await page.getByRole("button",{name:"Back",exact:true}).click();await expect(page.getByRole("button",{name:"Get started"})).toBeVisible();
});
