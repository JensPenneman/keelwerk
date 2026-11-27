import { expect, test } from 'vitest';
import { importedPaths } from './imported-paths.ts';

test('reads the relative named imports and skips type-only and package imports', () => {
  const text = [
    "import { a, type B, c as d } from './x.ts';",
    "import { e } from 'pkg';",
    "import{f}from'../f.ts'",
    "import {\n  g,\n} from   './g.ts'",
    "import { h } from ''",
  ].join('\n');
  expect(importedPaths(text)).toEqual(
    new Map([
      ['a', './x.ts'],
      ['d', './x.ts'],
      ['f', '../f.ts'],
      ['g', './g.ts'],
    ]),
  );
});

test('long adversarial inputs give the answer of the regular expression', () => {
  expect(importedPaths('import {'.repeat(100_000)).size).toBe(0);
  expect(importedPaths(`${'import {'.repeat(100_000)}} from ./x`).size).toBe(0);
  expect(importedPaths(`${'import{'.repeat(100_000)}}${' '.repeat(100_000)}x`).size).toBe(0);
  expect(importedPaths(`import {a} from '${'x'.repeat(100_000)}`).size).toBe(0);
  expect(importedPaths(`${'import {'.repeat(50_000)}a} from './ok.ts'`)).toEqual(
    new Map([['{a', './ok.ts']]),
  );
});
