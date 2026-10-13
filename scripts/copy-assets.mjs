import { cpSync, mkdirSync } from 'node:fs';
for (const asset of ['migrations', 'lua', 'sql']) {
  mkdirSync('packages/infrastructure/dist', { recursive: true });
  cpSync(`packages/infrastructure/src/${asset}`, `packages/infrastructure/dist/${asset}`, {
    recursive: true,
  });
}
