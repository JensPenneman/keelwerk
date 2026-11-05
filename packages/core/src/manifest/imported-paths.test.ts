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

test('long adversarial inputs finish fast and give the answer of the regular expression', () => {
  const started = performance.now();
  expect(importedPaths('import {'.repeat(10_000)).size).toBe(0);
  expect(importedPaths(`${'import {'.repeat(10_000)}} from ./x`).size).toBe(0);
  expect(importedPaths(`${'import{'.repeat(10_000)}}${' '.repeat(10_000)}x`).size).toBe(0);
  expect(importedPaths(`import {a} from '${'x'.repeat(10_000)}`).size).toBe(0);
  expect(importedPaths(`${'import {'.repeat(5_000)}a} from './ok.ts'`)).toEqual(
    new Map([['{a', './ok.ts']]),
  );
  expect(performance.now() - started).toBeLessThan(1000);
});
