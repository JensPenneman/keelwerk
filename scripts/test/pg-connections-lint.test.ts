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
import { allowedForms } from './support/pg-connection-forms-allowed.ts';
import { refusedForms } from './support/pg-connection-forms-refused.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const biomeBin = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');

interface Diagnostic {
  readonly category: string;
  readonly message: string;
  readonly location: { readonly path: string };
}

/** Every form with the verdict the rule gives it: the refused ones, then the allowed ones. */
const forms = [...refusedForms, ...allowedForms] as const;

const slug = (form: string): string => form.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase();
const pathOf = (form: string): string => `packages/x/src/${slug(form)}.ts`;

const placed = "import pg from 'pg';\nexport const driver = pg;\n";
/** Files whose path, not their text, decides: the place, a test and the opt-outs. */
const sources: Readonly<Record<string, string>> = {
  ...Object.fromEntries(forms.map(([form, source]) => [pathOf(form), source])),
  'packages/adapter-postgres/src/connections/in-place.ts': placed,
  'packages/x/src/in-test.test.ts': placed,
  'packages/x/src/with-reason.ts':
    "// biome-ignore lint/plugin: a test double that never connects\nimport pg from 'pg';\n\nexport const driver = pg;\n",
  'packages/x/src/without-reason.ts':
    "// biome-ignore lint/plugin:\nimport pg from 'pg';\n\nexport const driver = pg;\n",
};

// The root configuration and the plugin as they are committed, over sample sources in a project of
// their own, so that what the repository's own files do never decides the result.
const scratch = mkdtempSync(join(tmpdir(), 'keelwerk-pg-lint-'));
const found = new Map<string, Diagnostic[]>();

beforeAll(() => {
  mkdirSync(join(scratch, 'node_modules', '@keelwerk'), { recursive: true });
  symlinkSync(
    join(repositoryRoot, 'packages', 'biome-config'),
    join(scratch, 'node_modules', '@keelwerk', 'biome-config'),
    'dir',
  );
  mkdirSync(join(scratch, 'scripts', 'lint'), { recursive: true });
  cpSync(
    join(repositoryRoot, 'scripts', 'lint', 'pg-connections.grit'),
    join(scratch, 'scripts', 'lint', 'pg-connections.grit'),
  );
  const config = JSON.parse(readFileSync(join(repositoryRoot, 'biome.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  // Outside a git work tree the version control integration has nothing to read.
  config.vcs = undefined;
  writeFileSync(join(scratch, 'biome.json'), JSON.stringify(config));
  for (const [path, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), text);
  }
  const result = spawnSync(
    process.execPath,
    [biomeBin, 'lint', '--reporter=json', '--max-diagnostics=none', '--colors=off', '.'],
    { cwd: scratch, encoding: 'utf8' },
  );
  const json = result.stdout.split('\n').find((line) => line.startsWith('{'));
  if (json === undefined) throw new Error(`biome gave no report: ${result.stderr}`);
  for (const diagnostic of (JSON.parse(json) as { diagnostics: Diagnostic[] }).diagnostics) {
    const path = diagnostic.location.path;
    found.set(path, [...(found.get(path) ?? []), diagnostic]);
  }
}, 120_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const refusals = (path: string): Diagnostic[] =>
  (found.get(path) ?? []).filter((diagnostic) => diagnostic.message.startsWith('pg-connections:'));

describe('the pg-connections rule', () => {
  test.each(forms)('%s', (form, _source, verdict) => {
    const refused = refusals(pathOf(form)).length > 0;
    expect(refused ? 'refused' : 'allowed').toBe(verdict);
  });

  test('refuses each form once, however many specifiers it has', () => {
    for (const [form, , verdict] of forms) {
      if (verdict === 'refused') expect(refusals(pathOf(form)), form).toHaveLength(1);
    }
  });

  test('leaves the place that attaches the handling, and tests, alone', () => {
    expect(refusals('packages/adapter-postgres/src/connections/in-place.ts')).toEqual([]);
    expect(refusals('packages/x/src/in-test.test.ts')).toEqual([]);
  });

  test('accepts an opt-out that states its reason and refuses one that does not', () => {
    expect(found.get('packages/x/src/with-reason.ts')).toBeUndefined();
    const unexplained = found.get('packages/x/src/without-reason.ts') ?? [];
    expect(unexplained.length).toBeGreaterThan(0);
  });
});
