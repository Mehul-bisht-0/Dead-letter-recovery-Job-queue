import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
const names = [
  'core',
  'contracts',
  'infrastructure',
  'api',
  'worker',
  'dispatcher',
  'dashboard',
  'loadtest',
];
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      names.map((name) => [
        `@reliable-queue/${name}`,
        resolve(
          import.meta.dirname,
          `packages/${name}/src/${['api', 'dashboard'].includes(name) ? 'server' : 'index'}.ts`,
        ),
      ]),
    ),
  },
  test: {
    include: ['packages/**/src/__tests__/**/*.test.ts'],
    exclude: ['**/dist/**'],
    globals: false,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    maxWorkers: 1,
    pool: 'forks',
  },
});
