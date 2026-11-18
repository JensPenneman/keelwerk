import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { pinCopies } from '../pin-copies.ts';
import type { PinCopy } from '../pin-copy.ts';
import { syncPins } from '../sync-pins.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temporary root with a manifest and the given files. */
function fixture(files: Readonly<Record<string, string>>, manifest: object = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'keelwerk-pins-'));
  roots.push(root);
  const base = {
    packageManager: 'pnpm@11.28.12',
    devDependencies: {
      '@biomejs/biome': '2.6.8',
      '@types/node': '26.6.6',
      knip: '6.45.1',
      typescript: '7.0.2',
      vitest: '5.2.0',
    },
    pins: { npm: '11.21.2' },
  };
  writeFileSync(join(root, 'package.json'), JSON.stringify({ ...base, ...manifest }));
  const sources = {
    'pins/node.Dockerfile': 'FROM node:26.13.1-trixie\n',
    'pins/postgres.Dockerfile': 'FROM postgres:18.7-alpine\n',
  };
  for (const [file, text] of Object.entries({ ...sources, ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const vitestRow = (file: string, count = 1): PinCopy => ({
  file,
  source: 'vitest',
  pattern: /\bvitest: '([^']+)'/dg,
  count,
});

test('every copy in the repository follows its source', () => {
  expect(syncPins(repositoryRoot, false)).toEqual([]);
});

test('the table names existing files, gd patterns with one capture group and positive counts', () => {
  for (const row of pinCopies) {
    expect(statSync(join(repositoryRoot, row.file)).isFile()).toBe(true);
    expect(row.pattern.flags).toContain('g');
    expect(row.pattern.flags).toContain('d');
    expect(new RegExp(`${row.pattern.source}|`).exec('')?.length).toBe(2);
    expect(row.count).toBeGreaterThanOrEqual(1);
  }
});

test('check mode reports a copy that differs and leaves the file alone', () => {
  const root = fixture({ 'a.ts': "vitest: '5.1.0'\n" });
  expect(syncPins(root, false, [vitestRow('a.ts')])).toEqual([
    { file: 'a.ts', source: 'vitest', expected: '5.2.0', found: ['5.1.0'] },
  ]);
  expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe("vitest: '5.1.0'\n");
});

test('write mode replaces only the copied value', () => {
  const root = fixture({
    'a.ts': "x vitest: '5.1.0' knip: '1.0.0' y\nz\n",
    'b.ts': "vitest: '5.2.0'\n",
    'c.ts': "// vitest: '4.0.0'\nmore\n",
  });
  const knipRow: PinCopy = { file: 'a.ts', source: 'knip', pattern: /knip: '([^']+)'/dg, count: 1 };
  const rows = [vitestRow('a.ts'), knipRow, vitestRow('b.ts'), vitestRow('c.ts')];
  const untouched = statSync(join(root, 'b.ts')).mtimeMs;
  expect(syncPins(root, true, rows).map((drift) => drift.file)).toEqual(['a.ts', 'a.ts', 'c.ts']);
  expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe("x vitest: '5.2.0' knip: '6.45.1' y\nz\n");
  expect(readFileSync(join(root, 'c.ts'), 'utf8')).toBe("// vitest: '5.2.0'\nmore\n");
  expect(statSync(join(root, 'b.ts')).mtimeMs).toBe(untouched);
  expect(syncPins(root, false, rows)).toEqual([]);
});

test('a pattern matching another number of copies is a drift, and write refuses before writing', () => {
  const root = fixture({ 'a.ts': "vitest: '5.2.0'\n", 'b.ts': "vitest: '5.1.0'\n" });
  const rows = [vitestRow('a.ts', 2), vitestRow('b.ts')];
  expect(syncPins(root, false, rows)).toHaveLength(2);
  expect(() => syncPins(root, true, rows)).toThrow(/expected 2/);
  expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe("vitest: '5.2.0'\n");
  expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe("vitest: '5.1.0'\n");
});

test('the pnpm source drops the integrity suffix of packageManager', () => {
  const pnpm: PinCopy = { file: 'a.md', source: 'pnpm', pattern: /pnpm (\S+)/dg, count: 1 };
  const root = fixture(
    { 'a.md': 'pnpm 11.28.12\n' },
    { packageManager: 'pnpm@11.29.0+sha512.abc' },
  );
  expect(syncPins(root, false, [pnpm])[0]?.expected).toBe('11.29.0');
  const other = fixture({ 'a.md': 'pnpm 1.0.0\n' }, { packageManager: 'yarn@4.0.0' });
  expect(() => syncPins(other, false, [pnpm])).toThrow(/packageManager/);
});

test('a missing source member is named', () => {
  const root = fixture({ 'a.ts': "vitest: '5.2.0'\n" }, { pins: {} });
  expect(() => syncPins(root, false, [vitestRow('a.ts')])).toThrow(/pins\.npm/);
});

test('a pins member other than npm is refused', () => {
  const root = fixture(
    { 'a.ts': "vitest: '5.2.0'\n" },
    { pins: { npm: '11.21.2', nodeImage: 'n' } },
  );
  expect(() => syncPins(root, false, [vitestRow('a.ts')])).toThrow(/pins\.nodeImage/);
});

const imageRows = (): PinCopy[] =>
  pinCopies.filter((row) => row.source === 'nodeImage' || row.source === 'postgresImage');

test('the two container images follow their Dockerfiles, not the root manifest', () => {
  const rows = imageRows();
  expect(rows.map((row) => `${row.source} ${row.file}`)).toEqual([
    'nodeImage packages/cli/src/init/templates/compose-yaml.ts',
    'nodeImage examples/portal/.launchway/compose.yaml',
    'postgresImage packages/testing/src/postgres/postgres-image.ts',
  ]);
  const root = copiedRepository();
  writeFileSync(join(root, 'pins/node.Dockerfile'), '# moved\nFROM node:26.14.0-trixie\n');
  writeFileSync(join(root, 'pins/postgres.Dockerfile'), 'FROM postgres:18.8-alpine');
  expect(syncPins(root, false, rows).map((drift) => [drift.source, drift.expected])).toEqual([
    ['nodeImage', 'node:26.14.0-trixie'],
    ['nodeImage', 'node:26.14.0-trixie'],
    ['postgresImage', 'postgres:18.8-alpine'],
  ]);
  syncPins(root, true);
  const text = (file: string): string => readFileSync(join(root, file), 'utf8');
  expect(text('examples/portal/.launchway/compose.yaml')).toContain('image: node:26.14.0-trixie\n');
  expect(text('packages/testing/src/postgres/postgres-image.ts')).toContain(
    "postgresImage = 'postgres:18.8-alpine';",
  );
  expect(syncPins(root, false)).toEqual([]);
});

test('a source Dockerfile with no FROM line, with two or of the wrong form is refused by name', () => {
  for (const [text, message] of [
    ['# nothing here\n', 'found 0 FROM lines, expected one'],
    ['FROM node:1\nFROM node:2\n', 'found 2 FROM lines, expected one'],
    ['FROM --platform=linux/amd64 node:1\n', 'the FROM line is not of the form "FROM <image>"'],
  ] as const) {
    const root = fixture({ 'pins/node.Dockerfile': text, 'a.ts': "vitest: '5.2.0'\n" });
    expect(() => syncPins(root, false, [vitestRow('a.ts')])).toThrow(
      `pins/node.Dockerfile: ${message}`,
    );
  }
});

test('Dependabot watches the directory of the source Dockerfiles and leaves their majors alone', () => {
  const config = readFileSync(join(repositoryRoot, '.github', 'dependabot.yml'), 'utf8');
  const entry = config
    .split(/\n {2}- package-ecosystem: /)
    .find((part) => part.startsWith('docker\n'));
  expect(entry).toBeDefined();
  expect(entry).toContain('\n    directory: /pins\n');
  expect(entry).toMatch(
    /dependency-name: "\*"\n\s+update-types: \["version-update:semver-major"\]/,
  );
  for (const file of ['node', 'postgres']) {
    const dockerfile = readFileSync(join(repositoryRoot, 'pins', `${file}.Dockerfile`), 'utf8');
    expect(dockerfile.match(/^FROM /gm)).toHaveLength(1);
  }
});

test('a write followed by a check converges for a prerelease pnpm', () => {
  const pnpm = pinCopies.find(
    (row) => row.source === 'pnpm' && row.pattern.source.includes('pnpm[ @]'),
  );
  expect(pnpm).toBeDefined();
  const row = { ...(pnpm as PinCopy), file: 'a.md', count: 1 };
  const root = fixture(
    { 'a.md': 'Use pnpm 11.28.12 here.\nUse pnpm 11.28.12.\n' },
    { packageManager: 'pnpm@11.30.0-rc.1' },
  );
  const rows = [{ ...row, count: 2 }];
  const converged = 'Use pnpm 11.30.0-rc.1 here.\nUse pnpm 11.30.0-rc.1.\n';
  expect(syncPins(root, true, rows)).toHaveLength(1);
  expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe(converged);
  expect(syncPins(root, false, rows)).toEqual([]);
  expect(syncPins(root, true, rows)).toEqual([]);
  expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe(converged);
});

test('a prerelease with a hyphen inside is a valid pnpm version', () => {
  const pnpm = pinCopies.find(
    (row) => row.source === 'pnpm' && row.pattern.source.includes('pnpm[ @]'),
  );
  const row = { ...(pnpm as PinCopy), file: 'a.md', count: 1 };
  const root = fixture(
    { 'a.md': 'Use pnpm 11.28.12.\n' },
    { packageManager: 'pnpm@11.30.0-alpha-1' },
  );
  expect(syncPins(root, true, [row])).toHaveLength(1);
  expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('Use pnpm 11.30.0-alpha-1.\n');
  expect(syncPins(root, false, [row])).toEqual([]);
});

test('the exact Biome peer of the preset package is a copy of the Biome source', () => {
  const row = pinCopies.find((copy) => copy.file === 'packages/biome-config/package.json');
  expect(row).toBeDefined();
  const manifest = (peer: string): string =>
    `{\n  "peerDependencies": {\n    "@biomejs/biome": "${peer}"\n  },\n  "devDependencies": {\n    "@biomejs/biome": "2.6.0",\n    "vitest": "5.1.0"\n  }\n}\n`;
  const root = fixture({ 'packages/biome-config/package.json': manifest('2.6.0') });
  const rows = [row as PinCopy];
  expect(syncPins(root, false, rows)).toEqual([
    {
      file: 'packages/biome-config/package.json',
      source: 'biome',
      expected: '2.6.8',
      found: ['2.6.0'],
    },
  ]);
  syncPins(root, true, rows);
  expect(readFileSync(join(root, 'packages/biome-config/package.json'), 'utf8')).toBe(
    manifest('2.6.8').replace(
      '"@biomejs/biome": "2.6.8",\n    "vitest"',
      '"@biomejs/biome": "2.6.0",\n    "vitest"',
    ),
  );
  expect(syncPins(root, false, rows)).toEqual([]);
});

const scriptFiles = [
  'sync-pins.ts',
  'pin-copies.ts',
  'pin-copy.ts',
  'pin-drift.ts',
  'pin-sources.ts',
  'read-pin-sources.ts',
];

/** A copy of the repository's pin machinery and of every file it reads, in a temporary root. */
function copiedRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'keelwerk-pins-cli-'));
  roots.push(root);
  const files = [
    'package.json',
    'pins/node.Dockerfile',
    'pins/postgres.Dockerfile',
    ...new Set(pinCopies.map((copy) => copy.file)),
  ];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repositoryRoot, file), join(root, file));
  }
  mkdirSync(join(root, 'scripts'));
  for (const file of scriptFiles)
    copyFileSync(join(repositoryRoot, 'scripts', file), join(root, 'scripts', file));
  return root;
}

function runPins(
  root: string,
  ...args: string[]
): { status: number | null; stderr: string; stdout: string } {
  const run = spawnSync(process.execPath, ['scripts/sync-pins.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

test('the command line names the file and the pin of a stale pattern and prints no stack trace', () => {
  const root = copiedRepository();
  expect(runPins(root, '--check')).toMatchObject({ status: 0 });
  // README.md loses one of its two pnpm copies, and another file drifts: a write must stop first.
  const readme = join(root, 'README.md');
  writeFileSync(
    readme,
    readFileSync(readme, 'utf8').replace(/ and pnpm \d+\.\d+\.\d+/, ' and the package manager'),
  );
  const contributing = join(root, 'CONTRIBUTING.md');
  const drifted = readFileSync(contributing, 'utf8').replaceAll(
    /pnpm[ @]\d+\.\d+\.\d+/g,
    'pnpm 1.0.0',
  );
  writeFileSync(contributing, drifted);
  const before = readFileSync(readme, 'utf8');
  const run = runPins(root);
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(
    /^pins: a pattern no longer matches its copies, nothing was written \(README\.md: pnpm found 1, expected 2\)\n$/,
  );
  expect(run.stderr).not.toMatch(/\bat .*\.ts:\d+/);
  expect(run.stdout).toBe('');
  expect(readFileSync(readme, 'utf8')).toBe(before);
  expect(readFileSync(contributing, 'utf8')).toBe(drifted);
});
