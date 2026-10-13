import { cpSync, mkdirSync, readdirSync } from 'node:fs';
for (const name of readdirSync('packages')) {
  const target = `runtime/packages/${name}`;
  mkdirSync(target, { recursive: true });
  cpSync(`packages/${name}/package.json`, `${target}/package.json`);
  cpSync(`packages/${name}/dist`, `${target}/dist`, { recursive: true });
  if (name === 'dashboard')
    cpSync(`packages/${name}/public`, `${target}/public`, { recursive: true });
}
