import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "happy-dom", include: ["src/**/*.test.tsx"] },
  server: { port: 1420, strictPort: true },
});
