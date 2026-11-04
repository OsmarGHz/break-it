import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 45000,
    include: ['tests/**/*.test.ts'],
  },
});

