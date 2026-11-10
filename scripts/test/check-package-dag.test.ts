import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { checkPackageDag } from '../check-package-dag.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures: string[] = [];

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'package-dag-'));
  fixtures.push(root);
  await mkdir(join(root, 'packages'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

function manifest(name: string, fields: Readonly<Record<string, readonly string[]>> = {}): string {
  const entries = Object.entries(fields).map(([field, names]) => [
    field,
    Object.fromEntries(names.map((dependency) => [`@keelwerk/${dependency}`, 'workspace:*'])),
  ]);
  return JSON.stringify({ name: `@keelwerk/${name}`, ...Object.fromEntries(entries) });
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('the workspace graph follows section 22 and rule 9', async () => {
  expect(await checkPackageDag(repositoryRoot)).toEqual([]);
});

test('a workspace import in core is reported, tests included', async () => {
  const root = await fixture({
    'packages/core/package.json': manifest('core'),
    'packages/core/test/a.test.ts': "import { x } from '@keelwerk/data';\nexport const y = x;\n",
  });
  expect(await checkPackageDag(root)).toEqual([
    'packages/core/test/a.test.ts: imports @keelwerk/data',
  ]);
});

test('a runtime dependency outside the graph is reported', async () => {
  const root = await fixture({
    'packages/live/package.json': manifest('live', { dependencies: ['core', 'data'] }),
    'packages/core/package.json': manifest('core'),
  });
  expect(await checkPackageDag(root)).toEqual([
    'packages/live: depends on @keelwerk/data (dependencies)',
  ]);
});

test('a runtime file that imports a dev-only workspace package is reported', async () => {
  const root = await fixture({
    'packages/events/package.json': manifest('events', {
      dependencies: ['core'],
      devDependencies: ['testing'],
    }),
    'packages/events/src/a.ts':
      "// The header comment.\nimport type { T } from '@keelwerk/testing';\n\nexport type A = T;\n",
    'packages/events/src/a.test.ts':
      "import { t } from '@keelwerk/testing';\nexport const u = t;\n",
    'packages/core/package.json': manifest('core'),
  });
  expect(await checkPackageDag(root)).toEqual([
    'packages/events/src/a.ts: imports @keelwerk/testing',
  ]);
});

test('a template string after the import block is not read as an import', async () => {
  const root = await fixture({
    'packages/cli/package.json': manifest('cli', { dependencies: ['core'] }),
    'packages/cli/src/a.ts':
      "import { x } from '@keelwerk/core';\n\nexport const t = `import { y } from '@keelwerk/module-auth';`;\nexport const z = x;\n",
    'packages/core/package.json': manifest('core'),
  });
  expect(await checkPackageDag(root)).toEqual([]);
});

test('a cycle among runtime dependencies is reported', async () => {
  const root = await fixture({
    'packages/module-a/package.json': manifest('module-a', { dependencies: ['module-b'] }),
    'packages/module-b/package.json': manifest('module-b', { dependencies: ['module-a'] }),
  });
  expect(await checkPackageDag(root)).toEqual([
    'cycle: @keelwerk/module-a -> @keelwerk/module-b -> @keelwerk/module-a',
  ]);
});

test('a package without a rule is reported', async () => {
  const root = await fixture({ 'packages/widgets/package.json': manifest('widgets') });
  expect(await checkPackageDag(root)).toEqual([
    'packages/widgets: no rule in the package graph (section 22)',
  ]);
});
