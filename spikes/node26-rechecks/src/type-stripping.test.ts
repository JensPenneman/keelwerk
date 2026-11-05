import { mkdtempSync } from 'node:fs';
import { cp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { runNode } from './run-node.ts';

const fixture = fileURLToPath(new URL('../fixtures/linked-package', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'kw-'));

beforeAll(async () => {
  const modules = join(root, 'node_modules');
  await mkdir(modules, { recursive: true });
  await symlink(fixture, join(modules, 'linked-package'), 'dir');
  await cp(fixture, join(modules, 'copied-package'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{ "type": "module" }\n');
  for (const name of ['linked-package', 'copied-package']) {
    await writeFile(
      join(root, `${name}.ts`),
      `import { greet } from '${name}';\nconst text: string = greet('keelwerk').text;\nconsole.log(text);\n`,
    );
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test('a linked workspace package runs from source through the source condition', () => {
  const run = runNode(['--conditions=@keelwerk/source', 'linked-package.ts'], root);
  expect(run.stderr).toBe('');
  expect(run.stdout.trim()).toBe('hello keelwerk');
  expect(run.status).toBe(0);
});

test('the same package copied under node_modules is refused', () => {
  const run = runNode(['--conditions=@keelwerk/source', 'copied-package.ts'], root);
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
});

test('without the source condition the linked package resolves to dist and fails', () => {
  const run = runNode(['linked-package.ts'], root);
  expect(run.status).not.toBe(0);
  expect(run.stderr).not.toContain('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
  expect(run.stderr).toContain('ERR_MODULE_NOT_FOUND');
  expect(run.stderr).toContain('linked-package/dist/index.js');
});

test('a package linked by pnpm resolves to its .ts source through the source condition', () => {
  const run = runNode(
    [
      '--conditions=@keelwerk/source',
      '--input-type=module',
      '--eval',
      "await import('@keelwerk/core'); console.log(import.meta.resolve('@keelwerk/core'))",
    ],
    fileURLToPath(new URL('../../../packages/data', import.meta.url)),
  );
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  expect(run.stdout.trim().endsWith('packages/core/src/index.ts')).toBe(true);
});
