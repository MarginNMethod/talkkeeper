import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'happy-dom' }, server: { port: 1420, strictPort: true }, });
