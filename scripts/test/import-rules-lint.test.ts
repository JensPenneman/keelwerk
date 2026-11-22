import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { container, containerCases, presetCases } from './support/import-rule-cases.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const biomeBin = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');

interface Diagnostic {
  readonly category: string;
  readonly message: string;
  readonly location: { readonly path: string };
}

type Config = {
  plugins: { path: string }[];
  overrides: unknown[];
} & Record<string, unknown>;

/** What a root override of the old kind did: it replaced the preset's options of the rule. */
const oldOverrides = [
  {
    includes: ['**'],
    linter: {
      rules: {
        style: {
          noRestrictedImports: {
            level: 'error',
            options: {
              patterns: [
                {
                  group: [
                    '@testcontainers/postgresql',
                    '@testcontainers/postgresql/**',
                    'testcontainers',
                    'testcontainers/**',
                  ],
                  message: container,
                },
              ],
            },
          },
        },
      },
    },
  },
  {
    includes: ['packages/testing/src/postgres/**'],
    linter: { rules: { style: { noRestrictedImports: 'off' } } },
  },
];

/** The committed root configuration, or the committed one changed in one way. */
const variants = {
  committed: (config: Config): Config => config,
  withOldOverride: (config: Config): Config => ({
    ...config,
    overrides: [...oldOverrides, ...config.overrides],
  }),
  withoutPlugin: (config: Config): Config => ({
    ...config,
    plugins: config.plugins.filter((plugin) => !plugin.path.endsWith('testcontainers.grit')),
  }),
};
type Variant = keyof typeof variants;

const allCases = [...presetCases, ...containerCases] as const;
const slug = (path: string): string => path.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase();

// The root configuration and the plugins as they are committed, over sample sources in a project of
// their own, so that what the repository's own files do never decides the result. A sample is
// placed where a path decides its result; the same samples run once for each variant.
const scratches: string[] = [];
const found = new Map<Variant, Map<string, Diagnostic[]>>();

const lintVariant = (variant: Variant): Map<string, Diagnostic[]> => {
  const scratch = mkdtempSync(join(tmpdir(), 'keelwerk-import-lint-'));
  scratches.push(scratch);
  mkdirSync(join(scratch, 'node_modules', '@keelwerk'), { recursive: true });
  symlinkSync(
    join(repositoryRoot, 'packages', 'biome-config'),
    join(scratch, 'node_modules', '@keelwerk', 'biome-config'),
    'dir',
  );
  mkdirSync(join(scratch, 'scripts', 'lint'), { recursive: true });
  for (const plugin of ['pg-connections.grit', 'testcontainers.grit']) {
    cpSync(
      join(repositoryRoot, 'scripts', 'lint', plugin),
      join(scratch, 'scripts', 'lint', plugin),
    );
  }
  const config = JSON.parse(readFileSync(join(repositoryRoot, 'biome.json'), 'utf8')) as Config;
  // Outside a git work tree the version control integration has nothing to read.
  config.vcs = undefined;
  writeFileSync(join(scratch, 'biome.json'), JSON.stringify(variants[variant](config)));
  for (const [, path, source] of allCases) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), source);
  }
  const result = spawnSync(
    process.execPath,
    [biomeBin, 'lint', '--reporter=json', '--max-diagnostics=none', '--colors=off', '.'],
    { cwd: scratch, encoding: 'utf8' },
  );
  const json = result.stdout.split('\n').find((line) => line.startsWith('{'));
  if (json === undefined) throw new Error(`biome gave no report: ${result.stderr}`);
  const byPath = new Map<string, Diagnostic[]>();
  for (const diagnostic of (JSON.parse(json) as { diagnostics: Diagnostic[] }).diagnostics) {
    const path = diagnostic.location.path;
    byPath.set(path, [...(byPath.get(path) ?? []), diagnostic]);
  }
  return byPath;
};

beforeAll(() => {
  for (const variant of Object.keys(variants) as Variant[])
    found.set(variant, lintVariant(variant));
}, 240_000);

afterAll(() => {
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

/** The messages of the import rules (Biome's rule and the plugin) for a file, in a variant. */
const messagesOf = (variant: Variant, path: string): string[] =>
  (found.get(variant)?.get(path) ?? [])
    .filter(
      (diagnostic) =>
        diagnostic.category === 'lint/style/noRestrictedImports' ||
        diagnostic.message === container,
    )
    .map((diagnostic) => diagnostic.message);

const verdictOf = (messages: readonly string[]): string =>
  messages.length === 0 ? 'allowed' : messages.join(' | ');

/** The paths in a configuration at which `noRestrictedImports` is named as a key. */
const namesOf = (node: unknown, path = ''): string[] => {
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'noRestrictedImports' ? [`${path}/${key}`] : namesOf(value, `${path}/${key}`),
  );
};

describe('the import rules of the preset', () => {
  test.each(presetCases)('%s', (_name, path, _source, verdict) => {
    expect(verdictOf(messagesOf('committed', path)), slug(path)).toBe(verdict);
  });

  // The variant must lint: its own options are in force (the container message comes from Biome's
  // rule), and with them the preset's options are gone.
  test('each refusal is lost when a root override sets the rule options again', () => {
    for (const path of ['packages/x/src/import.ts', 'packages/x/src/postgres.ts']) {
      const rule = (found.get('withOldOverride')?.get(path) ?? []).filter(
        (diagnostic) => diagnostic.category === 'lint/style/noRestrictedImports',
      );
      expect(
        rule.map((diagnostic) => diagnostic.message),
        path,
      ).toEqual([container]);
    }
    for (const [name, path, , verdict] of presetCases) {
      if (verdict !== 'allowed')
        expect(messagesOf('withOldOverride', path), name).not.toContain(verdict);
    }
  });

  test('the root configuration names the rule nowhere', () => {
    const root = readFileSync(join(repositoryRoot, 'biome.json'), 'utf8');
    expect(namesOf(JSON.parse(root) as unknown)).toEqual([]);
  });
});

describe('the testcontainers rule', () => {
  test.each(containerCases)('%s', (_name, path, _source, verdict) => {
    expect(verdictOf(messagesOf('committed', path)), slug(path)).toBe(verdict);
  });

  // The variant must lint: the preset's verdicts, refusals included, are what they are committed.
  test('each refusal is lost when the plugin is not registered', () => {
    for (const [name, path, , verdict] of presetCases)
      expect(verdictOf(messagesOf('withoutPlugin', path)), name).toBe(verdict);
    for (const [name, path, , verdict] of containerCases) {
      if (verdict !== 'allowed') expect(messagesOf('withoutPlugin', path), name).toEqual([]);
    }
  });
});
