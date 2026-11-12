import { createRequire } from "node:module";
const { expect, test }: typeof import("@playwright/test") = createRequire(import.meta.url)(process.env.PLAYWRIGHT_TEST_MODULE ?? "@playwright/test");
test("MCP settings apply immediately and provide copyable configuration and access history", async ({ page }) => {
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("/src/main.tsx", "/e2e/harness.ts") });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const section = page.getByRole("region", { name: "Connect other AI tools" });
  for (const label of ["Allow other AI tools to read notes", "Include transcripts", "Include calendar meetings"]) {
    await expect(section.getByLabel(label)).not.toBeChecked();
    await section.getByLabel(label).check();
    await expect(section.getByLabel(label)).toBeChecked();
  }
  await section.getByText("How to connect", { exact: true }).click();
  await expect(section.getByLabel("Claude Desktop configuration")).toContainText("/opt/TalkKeeper/talkkeeper-mcp");
  for (const [button, expected] of [["Copy Claude Desktop configuration", '"mcpServers"'], ["Copy Claude Code command", "claude mcp add --transport stdio"], ["Copy generic configuration", '"mcpServers"']]) {
    await section.getByRole("button", { name: button, exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toContain(expected);
  }
  await section.getByRole("button", { name: "Test MCP connection" }).click();
  await expect(section.getByRole("status")).toContainText("Ready");
  await expect(section.getByText("search_notes", { exact: false })).toBeVisible();
  await section.getByRole("button", { name: "Clear recent access" }).click();
  await expect(section.getByText("No recent access")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Allow other AI tools to read notes")).toBeChecked();
});
