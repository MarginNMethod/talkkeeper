export default {
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:1420",
    headless: true,
    trace: "off",
    // Set PLAYWRIGHT_CHROMIUM_PATH to use a pre-installed browser.
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: process.env.PLAYWRIGHT_CHROMIUM_PATH ? ["--no-sandbox"] : [],
    },
  },
  webServer: {
    command: "pnpm dev --host 0.0.0.0",
    url: "http://localhost:1420",
    reuseExistingServer: true,
  },
};
