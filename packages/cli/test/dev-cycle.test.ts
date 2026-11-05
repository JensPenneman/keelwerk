import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { CliHost, HostProcess, HostSpawnOptions } from '../src/context/cli-host.ts';
import { runCycle } from '../src/dev/dev-cycle.ts';
import { devPathsOf } from '../src/dev/dev-paths.ts';
import { readyMarker } from '../src/dev/ready-marker.ts';
import { resultMarker } from '../src/dev/result-marker.ts';
import type { SyncResult } from '../src/dev/sync-result.ts';
import { createFakeHost } from './support/fake-host.ts';

const scratch: string[] = [];

afterEach(async () => {
  for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true });
});

/** The probe and the app as children that answer from a script: `syncs[0]` for the probe, `syncs[1]` for the probe after a confirmation. */
function children(syncs: readonly SyncResult[]): {
  readonly spawn: CliHost['spawn'];
  readonly probes: { contract: boolean }[];
} {
  const probes: { contract: boolean }[] = [];
  return {
    probes,
    spawn: (_command: string, args: readonly string[], options: HostSpawnOptions): HostProcess => {
      const name = args.at(-2);
      let end: (exit: { code: number | null; signal: 'SIGTERM' | null }) => void = () => undefined;
      const exited = new Promise<{ code: number | null; signal: 'SIGTERM' | null }>((resolve) => {
        end = resolve;
      });
      if (name === 'probe') {
        const asked = JSON.parse(args.at(-1) ?? '{}') as { contract: boolean };
        probes.push({ contract: asked.contract });
        const sync = syncs[probes.length - 1];
        const result = { producers: { written: [], notes: [], failures: [] }, sync };
        options.onStdout?.(`\n${resultMarker} ${JSON.stringify(result)}\n`);
        end({ code: 0, signal: null });
      } else {
        options.onStdout?.(`${readyMarker} ${JSON.stringify({ port: 1, socket: '/s' })}\n`);
      }
      return { exited, kill: () => end({ code: null, signal: 'SIGTERM' }) };
    },
  };
}

async function cycleWith(
  syncs: readonly SyncResult[],
  terminal: { stdinInteractive: boolean; answer: string },
): Promise<{
  readonly prints: string[];
  readonly notes: string[];
  readonly probes: { contract: boolean }[];
  readonly asked: string[];
}> {
  const root = await mkdtemp(join(tmpdir(), 'keelwerk-cycle-'));
  scratch.push(root);
  const child = children(syncs);
  const fake = createFakeHost({
    cwd: root,
    spawn: child.spawn,
    stdinInteractive: terminal.stdinInteractive,
  });
  const asked: string[] = [];
  const host: CliHost = {
    ...fake.host,
    promptLine: async (label: string) => {
      asked.push(label);
      return terminal.answer;
    },
  };
  const prints: string[] = [];
  const notes: string[] = [];
  const outcome = await runCycle({
    host,
    paths: devPathsOf(root),
    print: (line) => prints.push(line),
    note: (line) => notes.push(line),
    running: undefined,
  });
  expect(outcome.kind).toBe('running');
  return { prints, notes, probes: child.probes, asked };
}

const waiting: SyncResult = { applied: [], deferred: ['main/shop: shop 0002'], warnings: [] };

describe('contract steps in a restart cycle', () => {
  test('a yes runs the synchronisation again with them and shows what it applied, held back and warned', async () => {
    const second: SyncResult = {
      applied: ['main/shop: shop 0002'],
      deferred: ['main/shop: shop 0003'],
      warnings: ['a build is still live'],
    };
    const run = await cycleWith([waiting, second], { stdinInteractive: true, answer: 'y' });
    expect(run.probes).toEqual([{ contract: false }, { contract: true }]);
    expect(run.asked).toHaveLength(1);
    expect(run.prints).toContain('applied main/shop: shop 0002');
    expect(run.notes).toContain('warning: a build is still live');
    expect(run.notes.some((note) => note.startsWith('deferred: main/shop: shop 0003'))).toBe(true);
  });

  test('a no leaves the steps deferred and says how to apply them', async () => {
    const run = await cycleWith([waiting], { stdinInteractive: true, answer: 'n' });
    expect(run.probes).toEqual([{ contract: false }]);
    expect(run.notes.some((note) => note.startsWith('deferred: main/shop: shop 0002'))).toBe(true);
  });

  test('without a terminal nobody is asked and the steps stay deferred', async () => {
    const run = await cycleWith([waiting], { stdinInteractive: false, answer: 'y' });
    expect(run.asked).toEqual([]);
    expect(run.probes).toEqual([{ contract: false }]);
    expect(run.notes.some((note) => note.startsWith('deferred: main/shop: shop 0002'))).toBe(true);
  });
});
