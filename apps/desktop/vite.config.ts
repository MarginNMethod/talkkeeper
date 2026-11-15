import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.tsx"],
    // Windows CI runners are slow; the 5 s default timed out tests that pass in about 1 s elsewhere.
    testTimeout: 20000,
  },
  server: { port: 1420, strictPort: true },
});
