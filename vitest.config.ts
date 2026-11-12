import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@raisedline/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**', 'packages/cli/src/**'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
