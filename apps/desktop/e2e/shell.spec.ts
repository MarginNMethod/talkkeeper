import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(import.meta.url)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test.beforeEach(async ({page}) => {
  await page.route(/\/($|\?)/, async route => {
    const response = await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace("/src/main.tsx","/e2e/harness.ts")});
  });
  await page.goto("/?shell");
  await expect(page.getByRole("button", {name:"New note",exact:true})).toBeVisible();
});
test("Home groups notes and calendar events; Ask anything prefills chat", async ({page}) => {
  await expect(page.getByLabel("Coming up",{exact:true})).toContainText("Calendar planning");
  await expect(page.locator(".day-label")).toContainText(["Today","Yesterday"]);
  await expect(page.getByRole("button",{name:"Planning the next chapter",exact:true})).toBeVisible();
  await page.getByRole("textbox",{name:"Ask anything",exact:true}).fill("What did we decide?");
  await page.getByRole("textbox",{name:"Ask anything",exact:true}).press("Enter");
  await expect(page.getByLabel("Question",{exact:true})).toHaveValue("What did we decide?");
});
test("search shortcut, Escape and Enter open matching notes", async ({page}) => {
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox",{name:"Search notes",exact:true}).fill("Planning the next");
  await expect(page.getByRole("dialog",{name:"Search",exact:true})).toContainText("Planning the next chapter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog",{name:"Search",exact:true})).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox",{name:"Search notes",exact:true}).fill("Planning the next");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.getByRole("textbox",{name:"Search notes",exact:true}).press("Enter");
  await expect(page.getByLabel("Note title",{exact:true})).toHaveValue("Planning the next chapter");
});
test("sidebar collapse persists across reload", async ({page}) => {
  await page.getByRole("button",{name:"Toggle sidebar"}).click();
  await expect(page.getByRole("navigation",{name:"Main"})).toBeHidden();
  await page.reload();
  await expect(page.getByRole("navigation",{name:"Main"})).toBeHidden();
  await page.getByRole("button",{name:"Toggle sidebar"}).click();
  await expect(page.getByRole("navigation",{name:"Main"})).toBeVisible();
});
test("create rename and delete a folder while keeping notes", async ({page}) => {
  await page.getByRole("button",{name:"New folder",exact:true}).click();
  await page.getByLabel("Folder name",{exact:true}).fill("Research");
  await page.getByRole("button",{name:"Apply",exact:true}).click();
  await page.getByRole("button",{name:"Research",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Research",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Folder options for Research",exact:true}).click();
  await page.getByRole("button",{name:"Rename",exact:true}).click();
  await page.getByLabel("Folder name",{exact:true}).fill("Discoveries");
  await page.getByRole("button",{name:"Apply",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Discoveries",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Folder options for Discoveries",exact:true}).click();
  await page.getByRole("button",{name:"Delete folder…",exact:true}).click();
  await page.getByRole("alertdialog").getByRole("button",{name:"Delete folder",exact:true}).click();
  await expect(page.getByRole("button",{name:"Discoveries",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Planning the next chapter",exact:true})).toBeVisible();
});
test("search button returns focus and compact windows collapse navigation", async ({page}) => {
  const search = page.getByRole("button", {name:"Search notes",exact:true});
  await search.click();
  await expect(page.getByRole("textbox", {name:"Search notes",exact:true})).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
  await page.setViewportSize({width:800,height:800});
  await expect(page.getByRole("navigation", {name:"Main"})).toBeHidden();
  await page.getByRole("button", {name:"Toggle sidebar"}).click();
  await expect(page.getByRole("navigation", {name:"Main"})).toBeVisible();
});
test("new notes belong to their space and survive deleting it", async ({page}) => {
  await page.getByRole("button", {name:"Product conversations",exact:true}).click();
  await page.getByRole("button", {name:"New note",exact:true}).click();
  await page.getByRole("textbox", {name:"Note title",exact:true}).fill("Space research");
  await page.getByRole("button", {name:"Product conversations",exact:true}).click();
  await expect(page.getByRole("button", {name:"Space research",exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Folder options for Product conversations",exact:true}).click();
  await page.getByRole("button", {name:"Delete folder…",exact:true}).click();
  await page.getByRole("alertdialog").getByRole("button", {name:"Delete folder",exact:true}).click();
  await expect(page.getByRole("heading", {name:"All notes",exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:"Space research",exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:"Planning the next chapter",exact:true})).toBeVisible();
});
