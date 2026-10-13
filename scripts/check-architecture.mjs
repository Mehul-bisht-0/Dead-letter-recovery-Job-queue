import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const rules = {
  core: [],
  contracts: ['core'],
  infrastructure: ['core'],
  api: ['core', 'contracts', 'infrastructure'],
  worker: ['core', 'infrastructure'],
  dispatcher: ['core', 'infrastructure'],
  dashboard: ['core', 'contracts', 'infrastructure'],
  loadtest: ['contracts', 'infrastructure'],
};
const violations = [];
function scan(directory, packageName) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') scan(path, packageName);
      continue;
    }
    if (!path.endsWith('.ts')) continue;
    const source = readFileSync(path, 'utf8');
    const imports = [
      ...source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1]);
    for (const specifier of imports) {
      if (specifier.startsWith('@reliable-queue/')) {
        const target = specifier.slice('@reliable-queue/'.length);
        if (!rules[packageName].includes(target))
          violations.push(`${path}: illegal dependency ${specifier}`);
      }
      if (['pg', 'ioredis'].includes(specifier) && packageName !== 'infrastructure')
        violations.push(`${path}: storage dependency outside infrastructure`);
      if (packageName === 'core' && !specifier.startsWith('.'))
        violations.push(`${path}: core must be pure`);
      if (specifier.startsWith('.') && specifier.includes('../../'))
        violations.push(`${path}: cross-boundary relative import`);
    }
    if (packageName === 'core' && /process\.|console\.|\bsetInterval\b/.test(source))
      violations.push(`${path}: side effect in core`);
    if (
      packageName !== 'infrastructure' &&
      /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+jobs)\b/i.test(source)
    )
      violations.push(`${path}: SQL outside infrastructure`);
  }
}
for (const name of Object.keys(rules)) scan(`packages/${name}/src`, name);
if (violations.length) {
  process.stderr.write(violations.join('\n') + '\n');
  process.exitCode = 1;
} else process.stdout.write('Architecture boundaries passed\n');
