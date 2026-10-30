// Vitest configuration: tells the test runner where to find unit and end-to-end tests.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
