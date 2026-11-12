const port = process.env.PLAYWRIGHT_PORT ?? "1427";
export default {
  testDir: "./e2e",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: "off",
    // Set PLAYWRIGHT_CHROMIUM_PATH to use a pre-installed browser.
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: process.env.PLAYWRIGHT_CHROMIUM_PATH ? ["--no-sandbox"] : [],
    },
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
};
