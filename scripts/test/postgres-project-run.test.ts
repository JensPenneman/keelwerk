import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { postgresProjectRun } from '../postgres-project-run.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the shared run setting turns file parallelism off', () => {
  expect(postgresProjectRun).toStrictEqual({ fileParallelism: false });
});

const containerStarter = /start-?postgres|startPostgres|testcontainers/i;

// The configurations that must carry the shared setting: every PostgreSQL project configuration of
// a package or an example app, and the configuration of every spike whose tests start a container.
function postgresProjectConfigs(): string[] {
  const spikeConfigs = globSync('spikes/*/vitest.config.ts', { cwd: repositoryRoot }).filter(
    (config) =>
      globSync(`${dirname(config)}/src/**/*.test.ts`, { cwd: repositoryRoot }).some((file) =>
        containerStarter.test(readFileSync(join(repositoryRoot, file), 'utf8')),
      ),
  );
  return [
    ...globSync('packages/*/vitest.postgres.config.ts', { cwd: repositoryRoot }),
    ...globSync('examples/*/apps/*/vitest.postgres.config.ts', { cwd: repositoryRoot }),
    ...spikeConfigs,
  ];
}

test('every PostgreSQL project config spreads the shared run setting', () => {
  const configs = postgresProjectConfigs();
  expect(configs.length).toBeGreaterThanOrEqual(11);
  expect(configs).toContain('spikes/write-path/vitest.config.ts');
  for (const config of configs) {
    const text = readFileSync(join(repositoryRoot, config), 'utf8');
    expect(text, config).toContain('...postgresProjectRun,');
    expect(text, config).toMatch(
      /import \{ postgresProjectRun \} from '[^']*scripts\/postgres-project-run\.ts';/,
    );
    // No other fileParallelism key may follow the spread and turn the bound off again.
    expect(text.match(/fileParallelism/g) ?? [], config).toHaveLength(0);
  }
});

test('every package with PostgreSQL test files has a PostgreSQL project config', () => {
  const files = [
    ...globSync('packages/*/test/**/*.postgres.test.ts', { cwd: repositoryRoot }),
    ...globSync('examples/*/apps/*/test/**/*.postgres.test.ts', { cwd: repositoryRoot }),
  ];
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const packageDirectory = file.slice(0, file.indexOf('/test/'));
    const config = join(repositoryRoot, packageDirectory, 'vitest.postgres.config.ts');
    expect(() => readFileSync(config), file).not.toThrow();
  }
});
