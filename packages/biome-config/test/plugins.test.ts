import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

interface BiomeDiagnostic {
  readonly category: string;
  readonly message: string;
  readonly location: { readonly path: string; readonly start: { readonly line: number } };
}

interface BiomeReport {
  readonly summary: { readonly diagnosticsNotPrinted: number };
  readonly diagnostics: readonly BiomeDiagnostic[];
}

const packageRoot = join(import.meta.dirname, '..');
const fixturesRoot = join(packageRoot, 'plugins', 'fixtures');
// The pinned binary of this package's own dependency, never a global one.
const biomeBin = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');
const expectation = /\/\/ expect: (.+)$/;

const fixtures = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// A fixture extends the preset by its package name, and a fixture is a project of its own, so each
// run lints a copy in a temporary directory that has the link a package manager would put there;
// the source tree is never written to.
const scratch = mkdtempSync(join(tmpdir(), 'keelwerk-biome-'));
const workdirs = new Map<string, string>();

function prepare(fixture: string): void {
  const workdir = join(scratch, fixture);
  cpSync(join(fixturesRoot, fixture), workdir, { recursive: true });
  const scope = join(workdir, 'node_modules', '@keelwerk');
  mkdirSync(scope, { recursive: true });
  symlinkSync(packageRoot, join(scope, 'biome-config'), 'dir');
  workdirs.set(fixture, workdir);
}

function sourceFiles(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, base);
    return entry.name.endsWith('.ts') ? [relative(base, path)] : [];
  });
}

function lint(fixture: string): BiomeReport {
  const result = spawnSync(
    process.execPath,
    [biomeBin, 'lint', '--reporter=json', '--max-diagnostics=none', '--colors=off', '.'],
    { cwd: workdirs.get(fixture), encoding: 'utf8' },
  );
  const json = result.stdout.split('\n').find((line) => line.startsWith('{'));
  if (json === undefined)
    throw new Error(`biome printed no report:\n${result.stdout}${result.stderr}`);
  return JSON.parse(json) as BiomeReport;
}

// A plugin reports under the category "plugin"; its message starts with its name.
function ruleOf(diagnostic: BiomeDiagnostic): string {
  if (diagnostic.category !== 'plugin') return diagnostic.category;
  return `plugin/${diagnostic.message.split(':')[0]}`;
}

function expectedByFile(fixture: string): Record<string, string[]> {
  const directory = join(fixturesRoot, fixture);
  const result: Record<string, string[]> = {};
  for (const file of sourceFiles(directory)) {
    const found: string[] = [];
    readFileSync(join(directory, file), 'utf8')
      .split('\n')
      .forEach((text, index) => {
        const rules = expectation.exec(text)?.[1];
        if (rules === undefined) return;
        for (const rule of rules.split(',')) found.push(`${index + 1} ${rule.trim()}`);
      });
    result[file] = found.sort();
  }
  return result;
}

function actualByFile(fixture: string, report: BiomeReport): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const file of sourceFiles(join(fixturesRoot, fixture))) result[file] = [];
  for (const diagnostic of report.diagnostics) {
    const { path, start } = diagnostic.location;
    const found = result[path] ?? [];
    found.push(`${start.line} ${ruleOf(diagnostic)}`);
    result[path] = found;
  }
  for (const found of Object.values(result)) found.sort();
  return result;
}

describe('fixtures of the Biome preset and its GritQL plugins', () => {
  beforeAll(() => {
    for (const fixture of fixtures) prepare(fixture);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test('every plugin of the preset has a fixture directory', () => {
    const plugins = readdirSync(join(packageRoot, 'plugins'))
      .filter((name) => name.endsWith('.grit'))
      .map((name) => name.slice(0, -'.grit'.length));
    expect(plugins.length).toBeGreaterThan(0);
    for (const plugin of plugins) expect(fixtures).toContain(plugin);
  });

  describe.each(fixtures)('%s', (fixture) => {
    let report: BiomeReport | undefined;

    beforeAll(() => {
      report = lint(fixture);
    });

    test('flags exactly the expected diagnostics, per file', () => {
      if (report === undefined) throw new Error('biome did not run');
      expect(report.summary.diagnosticsNotPrinted).toBe(0);
      expect(actualByFile(fixture, report)).toEqual(expectedByFile(fixture));
    });

    test('has a file that must be flagged and a file that must pass', () => {
      const expected = Object.values(expectedByFile(fixture));
      expect(expected.some((found) => found.length > 0)).toBe(true);
      expect(expected.some((found) => found.length === 0)).toBe(true);
    });
  });
});
