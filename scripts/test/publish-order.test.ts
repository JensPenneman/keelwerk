import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { publishOrder } from '../publish-order.ts';
import { type FixturePackage, packageFixture } from './support/package-fixture.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function pkg(name: string, members: Readonly<Record<string, unknown>> = {}): FixturePackage {
  return { directory: name, manifest: { name: `@x/${name}`, version: '0.1.0', ...members } };
}

function names(packages: readonly FixturePackage[]): string[] {
  const root = packageFixture(packages);
  roots.push(root);
  return publishOrder(root).map((entry) => entry.name);
}

test('dependencies come before their dependents, ties by name', () => {
  expect(
    names([
      pkg('c', { dependencies: { '@x/b': 'workspace:*' } }),
      pkg('b', { peerDependencies: { '@x/a': 'workspace:*' } }),
      pkg('a'),
      pkg('d'),
    ]),
  ).toEqual(['@x/a', '@x/b', '@x/c', '@x/d']);
});

test('private packages and devDependencies are left out of the order', () => {
  expect(
    names([
      pkg('a', { devDependencies: { '@x/b': 'workspace:*' } }),
      pkg('b', { dependencies: { '@x/a': 'workspace:*' } }),
      pkg('hidden', { private: true }),
    ]),
  ).toEqual(['@x/a', '@x/b']);
});

test('a dependency cycle is refused', () => {
  expect(() =>
    names([
      pkg('a', { dependencies: { '@x/b': 'workspace:*' } }),
      pkg('b', { dependencies: { '@x/a': 'workspace:*' } }),
    ]),
  ).toThrow('dependency cycle: @x/a -> @x/b -> @x/a');
});

test('a published package that needs a private workspace package is refused', () => {
  for (const field of ['dependencies', 'peerDependencies']) {
    expect(() =>
      names([
        pkg('a', { [field]: { '@x/hidden': 'workspace:*' } }),
        pkg('hidden', { private: true }),
      ]),
    ).toThrow('@x/a is published but depends on the private workspace package @x/hidden');
  }
});

test('the tarball is named after the package and version', () => {
  const root = packageFixture([pkg('a')]);
  roots.push(root);
  expect(publishOrder(root)[0]?.tarball).toBe('x-a-0.1.0.tgz');
});

test('the workspace order holds every public package with core first and no private one', () => {
  const order = publishOrder(repositoryRoot).map((entry) => entry.name);
  const coreVersion = (
    JSON.parse(readFileSync(join(repositoryRoot, 'packages/core/package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  expect(order).toHaveLength(11);
  expect(order[0]).toBe('@keelwerk/core');
  expect(order.indexOf('@keelwerk/core')).toBeLessThan(order.indexOf('@keelwerk/data'));
  expect(order).not.toContain('@keelwerk/type-budgets');
  expect(order).not.toContain('@keelwerk/events');
  expect(
    publishOrder(repositoryRoot).find((entry) => entry.name === '@keelwerk/core')?.tarball,
  ).toBe(`keelwerk-core-${coreVersion}.tgz`);
});
