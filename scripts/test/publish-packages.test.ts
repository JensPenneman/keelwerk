import { rmSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import type { ProcessRun } from '../process-run.ts';
import { publishPackages } from '../publish-packages.ts';
import { packageFixture } from './support/package-fixture.ts';

const roots: string[] = [];
const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const dir = packageFixture([
    { directory: 'c', manifest: { name: '@x/c', version: '0.1.0', dependencies: { '@x/b': '1' } } },
    { directory: 'b', manifest: { name: '@x/b', version: '0.1.0', dependencies: { '@x/a': '1' } } },
    { directory: 'a', manifest: { name: '@x/a', version: '0.1.0' } },
  ]);
  roots.push(dir);
  return dir;
}

function manifestOf(name: string, directory: string, change: object = {}): object {
  return {
    name,
    version: '0.1.0',
    license: 'MIT',
    engines: { node: '>=26' },
    repository: {
      type: 'git',
      url: 'git+https://github.com/JensPenneman/keelwerk.git',
      directory: `packages/${directory}`,
    },
    exports: { '.': { default: './dist/index.js' } },
    ...change,
  };
}

interface Behaviour {
  readonly tarball?: (name: string) => object;
  readonly view?: (name: string) => { code: number; output: string };
  readonly list?: (name: string) => { code: number; output: string };
  readonly dry?: (name: string) => { code: number; output: string };
  readonly stage?: (name: string) => { code: number; output: string };
  readonly tag?: string;
  readonly npm?: string;
}

function fake(behaviour: Behaviour = {}): { run: ProcessRun; calls: string[] } {
  const calls: string[] = [];
  const nameOf = (args: readonly string[]): string =>
    /x-([abc])-0\.1\.0\.tgz/.exec(args.join(' '))?.[1] ?? '';
  const run: ProcessRun = (program, args) => {
    calls.push([program, ...args].join(' '));
    const ok = (output: string): Promise<{ code: number; output: string }> =>
      Promise.resolve({ code: 0, output });
    if (program === 'git') return ok(behaviour.tag ?? 'v0.1.0\n');
    if (program === 'tar' && args[0] === '-xzOf') {
      const letter = nameOf(args);
      const name = `@x/${letter}`;
      return ok(JSON.stringify(behaviour.tarball?.(name) ?? manifestOf(name, letter)));
    }
    if (program === 'tar') return ok('package/package.json\npackage/dist/index.js\n');
    if (args[0] === '--version') return ok(behaviour.npm ?? '11.21.1\n');
    if (args[0] === 'view') {
      const name = /@x\/[abc]/.exec(args[1] ?? '')?.[0] ?? '';
      return Promise.resolve(behaviour.view?.(name) ?? { code: 1, output: 'E404' });
    }
    if (args[0] === 'stage' && args[1] === 'list') {
      const name = args[2] ?? '';
      return Promise.resolve(behaviour.list?.(name) ?? { code: 0, output: '[]' });
    }
    if (args[0] === 'stage' && args[1] === 'publish') {
      const name = `@x/${nameOf(args)}`;
      if (args.includes('--dry-run'))
        return Promise.resolve(behaviour.dry?.(name) ?? { code: 0, output: '' });
      return Promise.resolve(
        behaviour.stage?.(name) ?? { code: 0, output: `+ ${name}@0.1.0 (staged with id ${id})\n` },
      );
    }
    return ok('');
  };
  return { run, calls };
}

function envOf(repository: string, ref: string, token: string): Record<string, string> {
  return Object.fromEntries([
    ['GITHUB_REPOSITORY', repository],
    ['GITHUB_REF', ref],
    ['NODE_AUTH_TOKEN', token],
  ]);
}

const real = envOf('JensPenneman/keelwerk', 'refs/heads/main', 'token');

function options(
  extra: { dryRun: boolean; env?: Record<string, string | undefined> },
  run: ProcessRun,
) {
  return { root: root(), tarballs: '/t', dryRun: extra.dryRun, env: extra.env ?? real, run };
}

const writes = (calls: readonly string[]): string[] =>
  calls.filter((call) => call.includes('stage publish') && !call.includes('--dry-run'));

test('a dry run checks and dry-runs every tarball and stages none', async () => {
  const { run, calls } = fake();
  const rows = await publishPackages(options({ dryRun: true, env: {} }, run));
  expect(rows.map((row) => [row.name, row.outcome])).toEqual([
    ['@x/a', 'dry run'],
    ['@x/b', 'dry run'],
    ['@x/c', 'dry run'],
  ]);
  expect(calls.filter((call) => call.includes('--dry-run'))).toHaveLength(3);
  expect(writes(calls)).toEqual([]);
});

test('a dry run is not refused on a scratch branch', async () => {
  const { run } = fake();
  const env = envOf('someone/fork', 'refs/heads/scratch', '');
  await expect(publishPackages(options({ dryRun: true, env }, run))).resolves.toHaveLength(3);
});

test('a tarball problem stops the run before anything is staged', async () => {
  const { run, calls } = fake({
    tarball: (name) => manifestOf(name, 'b', name === '@x/b' ? { engines: {} } : {}),
  });
  await expect(publishPackages(options({ dryRun: false }, run))).rejects.toThrow(
    '@x/b: engines.node is not >=26',
  );
  expect(writes(calls)).toEqual([]);
});

test('a failing dry run stops the run before anything is staged', async () => {
  const { run, calls } = fake({
    dry: (name) =>
      name === '@x/b' ? { code: 1, output: 'E400 bad tarball\n' } : { code: 0, output: '' },
  });
  await expect(publishPackages(options({ dryRun: false }, run))).rejects.toThrow(
    'the dry run of @x/b@0.1.0 failed: E400 bad tarball',
  );
  expect(writes(calls)).toEqual([]);
});

test('stages in dependency order with provenance, public access and tag latest', async () => {
  const { run, calls } = fake();
  const rows = await publishPackages(options({ dryRun: false }, run));
  expect(rows.map((row) => [row.name, row.outcome, row.stageId])).toEqual([
    ['@x/a', 'staged', id],
    ['@x/b', 'staged', id],
    ['@x/c', 'staged', id],
  ]);
  const staged = writes(calls);
  expect(staged.map((call) => /x-([abc])-/.exec(call)?.[1])).toEqual(['a', 'b', 'c']);
  for (const call of staged) expect(call).toContain('--provenance --access public --tag latest');
  expect(calls.some((call) => call.startsWith('npm publish'))).toBe(false);
});

test('a rerun skips versions that are published or staged', async () => {
  const { run, calls } = fake({
    view: (name) =>
      name === '@x/a' ? { code: 0, output: '"0.1.0"' } : { code: 1, output: 'E404' },
    list: (name) => ({
      code: 0,
      output: name === '@x/b' ? JSON.stringify([{ version: '0.1.0', id }]) : '[]',
    }),
  });
  const rows = await publishPackages(options({ dryRun: false }, run));
  expect(rows.map((row) => [row.outcome, row.stageId])).toEqual([
    ['already published', undefined],
    ['already staged', id],
    ['staged', id],
  ]);
  expect(writes(calls)).toHaveLength(1);
});

test('the first failure stops the run and leaves the rest not attempted', async () => {
  const { run } = fake({
    stage: (name) =>
      name === '@x/b'
        ? { code: 1, output: 'npm error\nnpm error E403 forbidden\n' }
        : { code: 0, output: `+ ${name}@0.1.0 (staged with id ${id})` },
  });
  const rows = await publishPackages(options({ dryRun: false }, run));
  expect(rows.map((row) => row.outcome)).toEqual(['staged', 'failed', 'not attempted']);
  expect(rows[1]?.detail).toBe('npm error E403 forbidden');
});

test('an answer that the version is staged already is not a failure', async () => {
  const { run } = fake({
    stage: () => ({ code: 1, output: 'npm error This version is already staged and exists' }),
  });
  const rows = await publishPackages(options({ dryRun: false }, run));
  expect(rows.map((row) => row.outcome)).toEqual([
    'already staged',
    'already staged',
    'already staged',
  ]);
});

test('trusted mode stages without a token and never runs npm stage list', async () => {
  const { run, calls } = fake({
    stage: (name) => ({ code: 0, output: `+ ${name}@0.1.0 (staged)` }),
  });
  const env = envOf('JensPenneman/keelwerk', 'refs/heads/main', '');
  const rows = await publishPackages(options({ dryRun: false, env }, run));
  expect(rows.map((row) => row.outcome)).toEqual(['staged', 'staged', 'staged']);
  expect(calls.some((call) => call.includes('stage list'))).toBe(false);
});

test('a real run from a fork is refused before any npm call that writes', async () => {
  const { run, calls } = fake();
  const env = envOf('someone/keelwerk', 'refs/heads/main', 'token');
  await expect(publishPackages(options({ dryRun: false, env }, run))).rejects.toThrow(
    'refused: stages only in JensPenneman/keelwerk, not in someone/keelwerk',
  );
  expect(writes(calls)).toEqual([]);
});

test('the stage id comes from the stage output, else from npm stage list', async () => {
  const other = '99999999-8888-7777-6666-555555555555';
  const asked = new Set<string>();
  const { run } = fake({
    stage: (name) => ({
      code: 0,
      output: name === '@x/a' ? `+ ${name} (staged with id ${id})` : '+ staged',
    }),
    list: (name) => {
      // The first question per package is the rerun check; it finds nothing yet.
      const first = !asked.has(name);
      asked.add(name);
      return {
        code: 0,
        output: first ? '[]' : JSON.stringify([{ version: '0.1.0', uuid: other }]),
      };
    },
  });
  const rows = await publishPackages(options({ dryRun: false }, run));
  expect(rows.map((row) => row.stageId)).toEqual([id, other, other]);
});

test('a package version that differs from the release version is refused', async () => {
  const dir = packageFixture([{ directory: 'a', manifest: { name: '@x/a', version: '0.2.0' } }]);
  roots.push(dir);
  const { run } = fake();
  await expect(
    publishPackages({ root: dir, tarballs: '/t', dryRun: true, env: {}, run }),
  ).rejects.toThrow('package versions differ from 0.1.0: @x/a@0.2.0');
});
