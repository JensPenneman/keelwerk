import { describe, expect, test } from 'vitest';
import type { CliHost, HostExit } from '../src/context/cli-host.ts';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';

interface Started {
  readonly command: string;
  readonly args: readonly string[];
}

/** A spawn that records each program and ends it with the exit code `codeOf` picks. */
function recording(codeOf: (started: Started) => number): {
  readonly started: Started[];
  readonly spawn: CliHost['spawn'];
} {
  const started: Started[] = [];
  return {
    started,
    spawn: (command, args) => {
      const entry = { command, args };
      started.push(entry);
      const exit: HostExit = { code: codeOf(entry), signal: null };
      return { exited: Promise.resolve(exit), kill: () => undefined };
    },
  };
}

const own = (started: Started): string =>
  started.args
    .slice(
      started.args.findIndex((arg) => arg.endsWith('keelwerk.ts') || arg.endsWith('keelwerk.js')) +
        1,
    )
    .join(' ');

function titles(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line.startsWith('['));
}

describe('keelwerk build', () => {
  test('runs steps 2 to 6 and 9 of section 13.8 in order', async () => {
    const child = recording(() => 0);
    const fake = createFakeHost({
      cwd: '/work/shop',
      files: { '/work/shop/pnpm-workspace.yaml': '' },
      spawn: child.spawn,
    });
    const run = await runCliWith(['build'], fake.host);
    expect(run.code).toBe(0);
    expect(
      child.started.map((started) =>
        started.command === 'pnpm' || started.command === 'git'
          ? `${started.command} ${started.args.join(' ')}`
          : own(started),
      ),
    ).toEqual([
      'git rev-parse --verify --quiet origin/main^{commit}',
      'pnpm exec biome ci .',
      'pnpm exec knip',
      'doctor --layout',
      'pnpm exec tsc -b',
      'pnpm exec vitest run',
      'generate --check',
      'db check',
      'surface diff --base origin/main',
    ]);
    expect(titles(run.stdout)).toEqual([
      '[1/8] 2a biome ci',
      '[2/8] 2b knip',
      '[3/8] 2c layout pass',
      '[4/8] 3 tsc -b (checks and emits dist)',
      '[5/8] 4 vitest run',
      '[6/8] 5 generate --check',
      '[7/8] 6 db check',
      '[8/8] 9 surface diff against origin/main',
    ]);
    expect(run.stdout).toContain('build passed');
  });

  test('stops at the first step that fails and exits 1', async () => {
    const child = recording((started) => (started.args.includes('tsc') ? 2 : 0));
    const fake = createFakeHost({
      cwd: '/work/shop',
      files: { '/work/shop/pnpm-workspace.yaml': '' },
      spawn: child.spawn,
    });
    const run = await runCliWith(['build'], fake.host);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('build failed at 3 tsc -b');
    expect(child.started.map((started) => started.args.at(1))).not.toContain('vitest');
  });

  test('skips the surface diff when the base is not a commit, and --base names another', async () => {
    const without = recording((started) => (started.command === 'git' ? 1 : 0));
    const first = await runCliWith(
      ['build'],
      createFakeHost({
        cwd: '/work/shop',
        files: { '/work/shop/pnpm-workspace.yaml': '' },
        spawn: without.spawn,
      }).host,
    );
    expect(first.code).toBe(0);
    expect(first.stderr).toContain('skipping the surface diff: origin/main is not a commit');
    expect(titles(first.stdout)).toHaveLength(7);
    const named = recording(() => 0);
    await runCliWith(
      ['build', '--base', 'release'],
      createFakeHost({
        cwd: '/work/shop',
        files: { '/work/shop/pnpm-workspace.yaml': '' },
        spawn: named.spawn,
      }).host,
    );
    expect(named.started.at(-1)?.args.slice(-2)).toEqual(['--base', 'release']);
  });
});
