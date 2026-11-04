import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const wireDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(wireDirectory, '..');

/** Leaf modules outside `src/wire/` the subpath may import by value; each must import nothing itself. */
const leaves = new Set([
  'fields/decode-base64-url.ts',
  'ids/parse-type-id.ts',
  'ids/render-type-id.ts',
]);

const valueImport = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm;

function importsOf(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(valueImport)].map((match) => match[1] ?? '');
}

describe('the wire subpath', () => {
  const files = readdirSync(wireDirectory).filter(
    (name) => name.endsWith('.ts') && !name.includes('.test.'),
  );

  test('has no value import from outside src/wire/ but dependency-free leaves', () => {
    for (const name of files) {
      for (const specifier of importsOf(join(wireDirectory, name))) {
        expect(specifier.startsWith('.'), `${name} imports the package '${specifier}'`).toBe(true);
        const target = relative(sourceDirectory, resolve(wireDirectory, specifier));
        if (!target.startsWith('wire/')) {
          expect(leaves.has(target), `${name} imports ${target}`).toBe(true);
        }
      }
    }
  });

  test('the leaves import nothing', () => {
    for (const leaf of leaves) {
      expect(importsOf(join(sourceDirectory, leaf))).toEqual([]);
    }
  });

  test('uses no node module', () => {
    for (const name of files) {
      expect(readFileSync(join(wireDirectory, name), 'utf8')).not.toMatch(/from 'node:/);
    }
  });
});
