import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import ciConfig from '../../vitest.ci.config.ts';
import { testLimits } from '../test-limits.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The projects of the pipeline's configuration, which holds the local list: every entry must be a
// path or pattern of configuration files, found the way Vitest finds them.
function projectConfigs(): string[] {
  const entries: unknown[] = ciConfig.test?.projects ?? [];
  const inline = entries.filter((entry) => typeof entry !== 'string');
  expect(
    inline,
    'a project is written inline in a list of projects; write it as a configuration file, so that the guard can read its limits',
  ).toHaveLength(0);
  const patterns = entries as string[];
  return [
    ...new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd: repositoryRoot }))),
  ].sort();
}

test('the one place holds a backstop limit for a case and a hook', () => {
  expect(testLimits.testTimeout).toBeGreaterThanOrEqual(60_000);
  expect(testLimits.hookTimeout).toBeGreaterThanOrEqual(testLimits.testTimeout);
});

test('no root configuration sets a limit of its own', () => {
  for (const config of ['vitest.config.ts', 'vitest.ci.config.ts']) {
    const text = readFileSync(join(repositoryRoot, config), 'utf8');
    expect(text, config).not.toMatch(/testTimeout|hookTimeout/);
  }
});

test('every project configuration takes both limits from the one place', async () => {
  const configs = projectConfigs();
  expect(configs.length).toBeGreaterThanOrEqual(30);
  expect(configs).toContain('packages/data/vitest.config.ts');
  expect(configs).toContain('scripts/vitest.config.ts');
  for (const config of configs) {
    const text = readFileSync(join(repositoryRoot, config), 'utf8');
    expect(text, config).toMatch(
      /import \{ testLimits \} from '[^']*scripts\/test-limits\.ts'|import \{ testLimits \} from '\.\/test-limits\.ts'/,
    );
    expect(text, config).toContain('...testLimits');
    // A limit written in the project itself, whatever its value, is a limit of its own.
    expect(text.match(/testTimeout|hookTimeout/g) ?? [], config).toHaveLength(0);
    const loaded = (await import(pathToFileURL(join(repositoryRoot, config)).href)) as {
      default: { test?: { testTimeout?: number; hookTimeout?: number } };
    };
    expect(loaded.default.test?.testTimeout, config).toBe(testLimits.testTimeout);
    expect(loaded.default.test?.hookTimeout, config).toBe(testLimits.hookTimeout);
  }
});
